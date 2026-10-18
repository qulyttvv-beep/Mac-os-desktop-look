// Mac Desktop — main process. Owns every window (menu bar, popup menus, dock,
// widgets, Spotlight, Launchpad) and all system integration.
const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  shell,
  globalShortcut,
  Menu,
  Tray,
  nativeImage,
  dialog,
  clipboard,
  MessageChannelMain,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Note: don't share one renderer process between the UI windows (--process-per-site):
// it saves memory, but the transparent windows (Dock, widgets) then randomly turn into
// opaque white rectangles.

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(start);
  // `Mac Desktop.exe --quit` cleanly stops a running instance (restores the taskbar).
  // Flags: --quit, --scene=<id>, --popup=<kind>, --wallpaper, --close-popup; anything else toggles Spotlight.
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) return app.quit();
    if (!settings) return;
    // --shot: save pictures of the widgets (not the sticky note) and the dock, for debugging
    if (argv.includes('--shot')) {
      const os = require('os');
      const list = [...Object.entries(widgets).filter(([n]) => n !== 'notes'), ['dock', dock]];
      for (const [n, w] of list) {
        if (w && !w.isDestroyed()) w.webContents.capturePage().then((img) => fs.writeFileSync(path.join(os.tmpdir(), `md-shot-${n}.png`), img.toPNG()));
      }
      return;
    }
    if (argv.includes('--dump')) {
      for (const w of allWindows()) {
        console.log('[dump]', w.getTitle(), JSON.stringify(w.getBounds()), w.isVisible(), 'pid', w.webContents.getOSProcessId());
      }
      let total = 0;
      for (const m of app.getAppMetrics()) {
        total += m.memory.privateBytes;
        console.log('[dump] process', m.pid, m.type, Math.round(m.memory.privateBytes / 1024) + ' MB private');
      }
      console.log('[dump] total', Math.round(total / 1024) + ' MB private');
      const mu = process.memoryUsage();
      console.log('[dump] audio level updates so far', audioEvents);
      console.log('[dump] main heap', Object.entries(mu).map(([k, v]) => `${k}=${Math.round(v / 1048576)}MB`).join(' '));
      return;
    }
    // --set=path=jsonValue: change a setting from the command line (same allow-list as the UI)
    const set = argv.find((a) => a.startsWith('--set='));
    if (set) {
      const m = /^--set=([\w.]+)=(.*)$/.exec(set);
      if (m && SETTABLE.test(m[1])) {
        try {
          settings.set(m[1], JSON.parse(m[2]));
        } catch {
          settings.set(m[1], m[2]);
        }
      }
      return;
    }
    const scene = argv.find((a) => a.startsWith('--scene='));
    if (scene) {
      settings.set('wallpaper.scene', scene.slice(8));
      if (!settings.get('wallpaper.on')) settings.set('wallpaper.on', true);
      return;
    }
    const pop = argv.find((a) => a.startsWith('--popup='));
    if (pop) {
      const k = pop.slice(8);
      if (k === 'start') return toggleStart();
      const anchor = k === 'wallpaper' || k === 'about' ? { center: true } : rightAnchor();
      if (argv.includes('--primary')) anchor.display = disp(); // open on the main display
      if (anchor.display && !anchor.center) anchor.x = anchor.display.bounds.width - 8;
      return openPopup(k, anchor);
    }
    if (argv.includes('--wallpaper')) return openPopup('wallpaper', { center: true });
    if (argv.includes('--close-popup')) return hidePopup();
    toggleSpotlight();
  });
}

const { Settings } = require('./settings');
const native = require('./native');
const helper = require('./helper');
const { Apps, defaultPinned } = require('./apps');
const system = require('./system');
const { LiveWallpaper } = require('./wallpaper');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'renderer');
const PRELOAD = path.join(ROOT, 'preload.js');
const MENUBAR_H = 28;
const POPUP_PAD = 26; // transparent margin around popups so their shadow isn't clipped
const WIDGET_PAD = 30; // transparent margin around each widget card (room for its shadow when lifted)
const WIDGET_SIZES = {
  clock: [164, 164],
  weather: [164, 164],
  calendar: [344, 164],
  system: [344, 164],
  notes: [164, 164],
};

let settings;
let apps;
const menubars = new Map(); // display id -> menu bar window (one per display)
let popup;
let dock;
let spotlight;
let launchpad;
let tray;
const widgets = {};
let fullscreenDisplay = null;
let shortcut = null;
let liveWall = null;
let audioEvents = 0;

const disp = () => screen.getPrimaryDisplay();
const cursorDisplay = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
const displayById = (id) => screen.getAllDisplays().find((d) => d.id === id) || null;
const allWindows = () =>
  [...menubars.values(), popup, dock, spotlight, launchpad, startWin, ...Object.values(widgets)].filter((w) => w && !w.isDestroyed());
const sendMenubars = (channel, ...args) => {
  for (const w of menubars.values()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
};

function broadcast(channel, ...args) {
  for (const w of allWindows()) w.webContents.send(channel, ...args);
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// The rectangle the glass backdrop image covers: the whole span while the live wallpaper
// runs, otherwise the display the window is on (Windows draws its wallpaper per display).
let glassFrame = null;
function frameFor(b) {
  return glassFrame || screen.getDisplayMatching(b).bounds;
}

// Apps pinned to Start: the user's list, or the Dock's apps plus common ones that exist.
const START_COMMON = /^(google chrome|microsoft edge|firefox|file explorer|settings|microsoft store|spotify|discord|steam|visual studio code|notepad|calculator|paint|photos|terminal|windows terminal|snipping tool|whatsapp|telegram|obs studio|epic games launcher)$/i;
function startPinned() {
  const own = settings.get('startMenu.pinned');
  if (Array.isArray(own)) return own;
  const list = apps.indexForClient();
  const ids = [];
  for (const p of settings.get('dock.pinned') || []) {
    if (!p.id || !p.id.startsWith('app:')) continue;
    const a = apps.findIndexApp(p.id.slice(4));
    if (a && !ids.includes(a.id)) ids.push(a.id);
  }
  for (const a of list) if (ids.length < 18 && START_COMMON.test(a.name) && !ids.includes(a.id)) ids.push(a.id);
  return ids.slice(0, 18);
}

// ---------------------------------------------------------------------------
// Real-time Liquid Glass: every glass window gets a MessagePort straight to the wallpaper
// window, which sends it its own piece of each new frame (see wallpaper/wallpaper.js).
const glassWins = new Set();
function glassSubscribe(win) {
  glassWins.add(win);
  const update = () => updateGlassSubs();
  win.on('move', update);
  win.on('resize', update);
  win.on('show', update);
  win.on('hide', update);
  win.on('closed', () => {
    glassWins.delete(win);
    updateGlassSubs();
  });
  win.webContents.on('did-finish-load', () => connectGlass(win));
}
function connectGlass(win) {
  const wall = liveWall && liveWall.running && liveWall.win;
  if (!wall || wall.isDestroyed() || win.isDestroyed()) return;
  const { port1, port2 } = new MessageChannelMain();
  wall.webContents.postMessage('wall:port', { id: win.id }, [port1]);
  win.webContents.postMessage('glass:port', null, [port2]);
  updateGlassSubs();
}
const updateGlassSubs = debounce(() => {
  if (!liveWall || !liveWall.running) return;
  const list = [...glassWins]
    .filter((w) => !w.isDestroyed())
    .map((w) => ({ id: w.id, visible: w.isVisible(), ...liveWall.frameRect(w.getBounds()) }));
  liveWall.send('wall:subs', list);
}, 16);

function sendPos(win) {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const F = frameFor(b);
  win.webContents.send('win:pos', { x: b.x - F.x, y: b.y - F.y });
}

function makeWin(page, opts, query = {}) {
  const win = new BrowserWindow({
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    thickFrame: false,
    show: false,
    type: 'toolbar',
    backgroundColor: '#00000000',
    title: 'Mac Desktop',
    webPreferences: {
      preload: PRELOAD,
      backgroundThrottling: false,
      spellcheck: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...opts,
  });
  win.setMenu(null);
  win.loadFile(path.join(RENDERER, page, 'index.html'), { query });
  win.on('move', () => sendPos(win));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.warn(`[${page}]`, e.message, e.sourceId ? `(${path.basename(e.sourceId)}:${e.lineNumber})` : '');
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // If a window's renderer ever dies, bring the page back.
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    console.warn(`[${page}] renderer gone (${d.reason}), reloading`);
    setTimeout(() => !win.isDestroyed() && win.webContents.reload(), 800);
  });
  return win;
}

// Windows itself moves app-bar windows around (e.g. pushes a menu bar below its own
// reserved strip while a fullscreen game runs). A misplaced menu bar then sits invisibly
// over the top of every app — Chrome's tabs and window buttons stop responding — so the
// menu bars and the dock snap straight back whenever anything moves them.
function pinBounds(win, want) {
  let fixes = 0;
  let since = 0;
  let retry = null;
  const check = debounce(() => {
    if (win.isDestroyed()) return;
    const w = want();
    if (!w) return;
    const b = win.getBounds();
    if (b.x === w.x && b.y === w.y && b.width === w.width && b.height === w.height) return;
    const now = Date.now();
    if (now - since > 2000) {
      since = now;
      fixes = 0;
    }
    // Never get into a tug of war with the shell — but don't give up for good either:
    // look again once things have settled.
    if (++fixes > 6) {
      clearTimeout(retry);
      retry = setTimeout(check, 2500);
      return;
    }
    win.setBounds(w);
  }, 30);
  win.on('move', check);
  win.on('resize', check);
  win.on('show', check);
  return check;
}

// ---------------------------------------------------------------------------
// Menu bar
function menubarBounds(d) {
  return { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: MENUBAR_H };
}

// Windows won't make a transparent window shorter than 64 px, so the 28 px menu bar's
// window really reached 36 px further down — invisible, but it still took every click
// there: Chrome's tabs and new-tab button, minimize / maximize / close of every
// maximized app. Clipping the window to the bar itself lets those clicks through.
function placeMenubar(w, d) {
  if (!w || w.isDestroyed() || !d) return;
  w.setBounds(menubarBounds(d));
  w.setShape([{ x: 0, y: 0, width: Math.round(d.bounds.width), height: MENUBAR_H }]);
}

function menubarDisplays() {
  return settings.get('menubar.allDisplays') === false ? [disp()] : screen.getAllDisplays();
}

// One menu bar per display (like macOS), each reserving its strip at the top.
function syncMenubars() {
  const want = menubarDisplays();
  const ids = new Set(want.map((d) => d.id));
  for (const [id, w] of menubars) {
    if (ids.has(id) && !w.isDestroyed()) continue;
    if (!w.isDestroyed()) {
      native.appbarRemove(native.hwndOf(w));
      w.destroy();
    }
    menubars.delete(id);
  }
  for (const d of want) {
    const existing = menubars.get(d.id);
    if (existing) {
      placeMenubar(existing, d);
      continue;
    }
    const w = makeWin('menubar', { ...menubarBounds(d), focusable: false, alwaysOnTop: true });
    w._displayId = d.id;
    placeMenubar(w, d);
    pinBounds(w, () => {
      const dd = displayById(w._displayId);
      return dd && menubarBounds(dd);
    });
    w.on('show', () => placeMenubar(w, displayById(w._displayId)));
    w.setAlwaysOnTop(true, 'screen-saver');
    // Explorer restarted (crash, update): the reserved strip is gone, so maximized windows
    // would slide up under the bar. Register again.
    if (taskbarCreatedMsg) {
      w.hookWindowMessage(taskbarCreatedMsg, () => setTimeout(shellRestarted, 1500));
    }
    w.once('ready-to-show', () => {
      if (fullscreenDisplay !== d.id) w.showInactive();
      applyReserve(true);
    });
    menubars.set(d.id, w);
  }
}

const taskbarCreatedMsg = native.taskbarCreatedMessage();
const shellRestarted = debounce(() => {
  console.warn('[shell] Explorer restarted: reserving the menu bar and dock strips again');
  for (const w of [...menubars.values(), dock]) {
    if (w && !w.isDestroyed()) {
      native.appbarForget(native.hwndOf(w));
      w._reserveKey = '';
    }
  }
  applyReserve(true);
  applyDockReserve();
  applyTaskbar();
}, 300);

// Self-check: if the work area ever stops leaving room for the bar (the shell dropped our
// app bar), re-register it instead of letting windows slide under the bar.
let reserveFixedAt = 0;
function checkReserve() {
  if (!settings.get('menubar.reserve') || Date.now() - reserveFixedAt < 20000) return;
  for (const [id, w] of menubars) {
    const d = displayById(id);
    if (!d || w.isDestroyed()) continue;
    if (d.workArea.y >= d.bounds.y + MENUBAR_H - 1) continue;
    reserveFixedAt = Date.now();
    console.warn('[menubar] reserved strip missing, registering again');
    native.appbarForget(native.hwndOf(w));
    w._reserveKey = '';
    applyReserve(true);
    return;
  }
}

function applyReserve(force) {
  for (const [id, w] of menubars) {
    const d = displayById(id);
    if (!d || w.isDestroyed()) continue;
    const hwnd = native.hwndOf(w);
    if (!settings.get('menubar.reserve')) {
      native.appbarRemove(hwnd);
      w._reserveKey = '';
      continue;
    }
    const b = menubarBounds(d);
    const r = screen.dipToScreenRect(null, b);
    const key = JSON.stringify(r);
    if (!force && key === w._reserveKey) continue;
    w._reserveKey = key;
    native.appbarSet(hwnd, { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }, 'top');
    placeMenubar(w, d);
  }
}

function foregroundInfo() {
  const fg = apps.lastFg;
  if (!fg) return { name: 'Finder', finder: true, title: '' };
  const finder = fg.base === 'explorer.exe' || fg.cls === 'Progman' || fg.cls === 'WorkerW';
  return { name: finder ? 'Finder' : apps.appName(fg), finder, title: fg.title || '' };
}

// ---------------------------------------------------------------------------
// Popup menus (Apple menu, app menus, Control Center, calendar, settings...)
let popupKind = null;
let popupAnchor = null;
let popupToken = 0;
let popupShownAt = 0;

function createPopup() {
  popup = makeWin('popup', { width: 300, height: 200, focusable: true, alwaysOnTop: true });
  glassSubscribe(popup);
  popup.setAlwaysOnTop(true, 'screen-saver');
  popup.on('blur', () => {
    if (Date.now() - popupShownAt > 120) hidePopup();
  });
}

function openPopup(kind, anchor) {
  popupKind = kind;
  popupAnchor = { x: 0, align: 'left', ...(anchor || {}) };
  if (!popupAnchor.display) popupAnchor.display = cursorDisplay();
  popupToken += 1;
  popup.webContents.send('popup:show', { kind, token: popupToken, app: foregroundInfo(), center: !!popupAnchor.center });
  for (const [id, w] of menubars) {
    if (!w.isDestroyed()) w.webContents.send('popup:state', id === popupAnchor.display.id ? kind : null);
  }
  startHoverTracking();
}

// While a menu is open, sliding the pointer along the menu bar switches menus (like macOS).
// Polled from here because the menu bar window doesn't reliably get hover events while
// the popup holds focus.
const menuRects = new Map(); // display id -> menu item rects
let hoverTimer = null;
function startHoverTracking() {
  if (hoverTimer) return;
  hoverTimer = setInterval(() => {
    if (!popupKind || !popup.isVisible() || popupAnchor.center) {
      clearInterval(hoverTimer);
      hoverTimer = null;
      return;
    }
    const d = popupAnchor.display || disp();
    const p = screen.getCursorScreenPoint();
    if (p.y < d.bounds.y || p.y >= d.bounds.y + MENUBAR_H || p.x < d.bounds.x || p.x >= d.bounds.x + d.bounds.width) return;
    const x = p.x - d.bounds.x;
    const r = (menuRects.get(d.id) || []).find((m) => x >= m.left && x < m.right);
    if (r && r.kind !== popupKind) {
      openPopup(r.kind, r.align === 'right' ? { x: r.right, align: 'right', display: d } : { x: r.left, align: 'left', display: d });
    }
  }, 40);
}

// macOS keeps every window's title bar below the menu bar. Windows lets apps (or you)
// put a window's top edge under it — then its title bar, tabs and minimize / maximize /
// close buttons are hidden behind the bar and can't be clicked. Such windows are moved
// down just below the bar (never while a mouse button is held, so dragging still works).
const belowBarFixes = new Map();
function keepBelowMenubar() {
  if (!settings.get('menubar.reserve') || native.primaryButtonDown()) return;
  const bars = [...menubars.entries()].filter(([, w]) => !w.isDestroyed() && w.isVisible()).map(([id]) => displayById(id)).filter(Boolean);
  if (!bars.length) return;
  const now = Date.now();
  for (const w of apps.running.flatMap((g) => g.windows)) {
    if (native.isMinimized(w.hwnd)) continue;
    const fixed = belowBarFixes.get(w.hwnd);
    if (fixed && fixed.n >= 3 && now - fixed.at < 30000) continue; // the app insists: leave it be
    const r = native.windowRect(w.hwnd);
    if (!r) continue;
    for (const d of bars) {
      const p = screen.dipToScreenRect(null, d.bounds);
      const barBottom = p.y + Math.round(MENUBAR_H * d.scaleFactor);
      if (r.top >= barBottom || r.top < p.y - 24 || r.right <= p.x + 8 || r.left >= p.x + p.width - 8) continue;
      if (native.isZoomed(w.hwnd) || native.isFullscreen(w.hwnd, p)) continue;
      const h = Math.min(r.bottom - r.top, p.y + p.height - barBottom);
      native.moveWindow(w.hwnd, r.left, barBottom, r.right - r.left, h);
      belowBarFixes.set(w.hwnd, { n: fixed && now - fixed.at < 30000 ? fixed.n + 1 : 1, at: now });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Start menu: a window of its own (Windows key, Apple menu, Spotlight, tray). Search,
// pinned apps, recent files, every app A–Z, user, folders and power.
let startWin = null;
let startShownAt = 0;
const START_PAD = 28; // transparent margin for the panel's shadow
const START_SIZE = [640, 700]; // the panel itself

function createStart() {
  const win = makeWin('start', { width: START_SIZE[0] + START_PAD * 2, height: START_SIZE[1] + START_PAD * 2, focusable: true, alwaysOnTop: true });
  startWin = win;
  glassSubscribe(win);
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.on('blur', () => {
    if (win._menuOpen || Date.now() - startShownAt < 200) return;
    hideStart();
  });
  win.on('closed', () => {
    if (startWin === win) startWin = null;
  });
}

function toggleStart() {
  if (startWin && !startWin.isDestroyed() && startWin.isVisible()) return hideStart();
  if (!startWin || startWin.isDestroyed()) {
    createStart();
    startWin.webContents.once('did-finish-load', () => setTimeout(showStart, 30));
    return;
  }
  showStart();
}

function showStart() {
  const win = startWin;
  if (!win || win.isDestroyed()) return;
  hidePopup();
  if (spotlight && spotlight.isVisible()) spotlight.hide();
  if (launchpad && !launchpad.isDestroyed() && launchpad.isVisible()) launchpad.webContents.send('launchpad:close');
  // centred on the display with the pointer, sitting just above the dock
  const d = cursorDisplay();
  const wa = d.workArea;
  const gap = settings.get('dock.autohide') ? Math.round(settings.get('dock.size') + 22) : 6;
  const W = START_SIZE[0] + START_PAD * 2;
  const H = Math.min(START_SIZE[1] + START_PAD * 2, wa.height - gap + START_PAD - 8);
  win.setBounds({
    x: Math.round(d.bounds.x + (d.bounds.width - W) / 2),
    y: Math.round(wa.y + wa.height - gap - H + START_PAD),
    width: W,
    height: H,
  });
  sendPos(win);
  startShownAt = Date.now();
  win.webContents.send('start:show');
  win.show();
  win.focus();
  setTimeout(() => !win.isDestroyed() && win.isVisible() && !win.isFocused() && native.focusWindow(native.hwndOf(win)), 60);
}

function hideStart() {
  if (!startWin || startWin.isDestroyed() || !startWin.isVisible()) return;
  startWin.hide();
  startWin.webContents.send('start:hidden');
}

// Recently opened files (what Windows lists under "Recommended"), newest first.
let lastRecent = [];
const iconCache = new Map();
async function fileIcon(file) {
  const ext = path.extname(file).toLowerCase();
  const key = ext === '.exe' || ext === '.lnk' ? file : ext;
  if (iconCache.has(key)) return iconCache.get(key);
  let url = null;
  try {
    const img = await app.getFileIcon(file, { size: 'normal' });
    url = img.isEmpty() ? null : img.toDataURL();
  } catch {
    /* no icon */
  }
  if (iconCache.size > 200) iconCache.clear();
  iconCache.set(key, url);
  return url;
}
async function recentFiles() {
  const dir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
  let names = [];
  try {
    names = (await fs.promises.readdir(dir)).filter((n) => n.toLowerCase().endsWith('.lnk'));
  } catch {
    return [];
  }
  const stats = await Promise.all(
    names.map((n) =>
      fs.promises.stat(path.join(dir, n)).then(
        (s) => ({ n, t: s.mtimeMs }),
        () => null
      )
    )
  );
  const out = [];
  for (const s of stats.filter(Boolean).sort((a, b) => b.t - a.t)) {
    if (out.length >= 9) break;
    let target = '';
    try {
      target = shell.readShortcutLink(path.join(dir, s.n)).target;
    } catch {
      continue;
    }
    // files only, and never wait on a network share that may be offline
    if (!target || target.startsWith('\\\\') || !path.extname(target)) continue;
    try {
      if (!(await fs.promises.stat(target)).isFile()) continue;
    } catch {
      continue;
    }
    out.push({ path: target, name: path.basename(target), dir: path.basename(path.dirname(target)), t: s.t, icon: await fileIcon(target) });
  }
  lastRecent = out;
  return out;
}

async function startData() {
  const showRecent = settings.get('startMenu.recent') !== false;
  return {
    apps: apps.indexForClient(),
    pinned: startPinned(),
    recent: showRecent ? await recentFiles() : null,
    user: require('os').userInfo().username,
  };
}

function applyWinKey() {
  helper.call('keys.enable', { on: settings.get('startMenu.winKey') !== false }).catch(() => {});
}

function hidePopup() {
  if (!popupKind) return;
  popupKind = null;
  if (popup && !popup.isDestroyed()) {
    popup.hide();
    popup.webContents.send('popup:hidden');
  }
  sendMenubars('popup:state', null);
}

function sizePopup({ w, h, token, top }) {
  if (token !== popupToken || !popupKind) return;
  const d = (popupAnchor.display && displayById(popupAnchor.display.id)) || disp();
  const W = Math.ceil(w) + POPUP_PAD * 2;
  const H = Math.min(Math.ceil(h) + POPUP_PAD + top, d.workArea.height);
  let x;
  let y;
  if (popupAnchor.center) {
    x = d.bounds.x + (d.bounds.width - W) / 2;
    y = d.bounds.y + Math.max(MENUBAR_H + 20, (d.bounds.height - H) * 0.35);
  } else {
    // Window starts exactly at the menu bar's bottom edge so it never covers menu items.
    y = d.bounds.y + MENUBAR_H;
    x =
      popupAnchor.align === 'right'
        ? d.bounds.x + popupAnchor.x - W + POPUP_PAD
        : d.bounds.x + popupAnchor.x - POPUP_PAD;
  }
  x = Math.max(d.bounds.x - POPUP_PAD + 4, Math.min(x, d.bounds.x + d.bounds.width - W + POPUP_PAD - 4));
  popup.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
  sendPos(popup);
  if (!popup.isVisible()) {
    popupShownAt = Date.now();
    popup.show();
  }
  popup.focus();
  if (!popup.isFocused()) native.focusWindow(native.hwndOf(popup));
}

// ---------------------------------------------------------------------------
// Dock
function dockHeight() {
  const s = settings.get('dock');
  return Math.ceil(s.size * (s.magnify ? s.magnifyScale : 1)) + 96;
}

let dockDisplayId = null;
let dockReserve = null; // bottom edge (DIP) of the strip the dock reserves, when it's always shown
const dockDisplay = () => displayById(dockDisplayId) || disp();

function dockBounds() {
  const d = dockDisplay();
  const wa = d.workArea;
  const h = dockHeight();
  const bottom = dockReserve && dockReserve.displayId === d.id ? dockReserve.bottom : wa.y + wa.height;
  return { x: d.bounds.x, y: bottom - h, width: d.bounds.width, height: h };
}

// When the dock is always visible it reserves its strip like the Windows taskbar does,
// so maximized and snapped windows end above it instead of underneath.
function applyDockReserve() {
  if (!dock || dock.isDestroyed()) return;
  const hwnd = native.hwndOf(dock);
  if (settings.get('dock.autohide')) {
    native.appbarRemove(hwnd);
    dockReserve = null;
    dock._reserveKey = '';
  } else {
    const d = disp();
    dockDisplayId = d.id;
    const h = Math.round(settings.get('dock.size') + 26);
    const r = screen.dipToScreenRect(null, { x: d.bounds.x, y: d.bounds.y + d.bounds.height - h, width: d.bounds.width, height: h });
    // Re-reserving an unchanged strip still makes Windows re-lay out every maximized window
    // (and fires display-metrics-changed again), so only talk to the shell on real changes.
    const key = JSON.stringify(r);
    if (key === dock._reserveKey && dockReserve) {
      dock.setBounds(dockBounds());
      sendPos(dock);
      return;
    }
    dock._reserveKey = key;
    const got = native.appbarSet(hwnd, { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }, 'bottom');
    if (got) {
      const dip = screen.screenToDipRect(null, { x: got.left, y: got.top, width: got.right - got.left, height: got.bottom - got.top });
      dockReserve = { displayId: d.id, bottom: dip.y + dip.height };
    }
  }
  dock.setBounds(dockBounds());
  sendPos(dock);
}

// With hiding on and several displays, the dock appears on whichever display you push
// the pointer against the bottom edge of (macOS behaviour).
function pollDockDisplay() {
  if (!dock || dock.isDestroyed() || !settings.get('dock.autohide') || fullscreenDisplay != null) return;
  const all = screen.getAllDisplays();
  if (all.length < 2) return;
  const p = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(p);
  if (d.id === dockDisplay().id || p.y < d.bounds.y + d.bounds.height - 3) return;
  dockDisplayId = d.id;
  dock.setBounds(dockBounds());
  sendPos(dock);
  if (!glassFrame) dock.webContents.send('wallpaper');
  dock.webContents.send('dock:reveal');
}

// While the dock is click-through it gets no mouse events, so tell it where the pointer is
// whenever it's over (or just left) the dock window: hover, magnification, edge reveal.
let dockInteractive = false;
let dockPtr = null;
function pollDockPointer() {
  if (!dock || dock.isDestroyed() || dockInteractive || !dock.isVisible()) return;
  const p = screen.getCursorScreenPoint();
  const b = dock.getBounds();
  const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
  if (!inside && !dockPtr) return;
  const x = p.x - b.x;
  const y = inside ? p.y - b.y : -1000;
  if (dockPtr && dockPtr.x === x && dockPtr.y === y) return;
  dockPtr = inside ? { x, y } : null;
  dock.webContents.send('dock:pointer', { x, y });
}

function createDock() {
  dockDisplayId = disp().id;
  dock = makeWin('dock', { ...dockBounds(), focusable: true, alwaysOnTop: true });
  glassSubscribe(dock);
  pinBounds(dock, dockBounds);
  dock.setAlwaysOnTop(true, 'screen-saver');
  // Click-through until the pointer is over the dock. No `forward` here: on Windows that
  // installs a system-wide low-level mouse hook, which makes every app's mouse input wait
  // on this process (laggy scrolling and clicks in Chrome, games...). pollDockPointer
  // feeds the dock the pointer position instead.
  dock.setIgnoreMouseEvents(true);
  dockInteractive = false;
  dock.once('ready-to-show', () => {
    dock.showInactive();
    applyDockReserve();
  });
}

const sendDock = debounce(() => {
  if (dock && !dock.isDestroyed()) dock.webContents.send('dock:state', apps.dockModel());
}, 40);

function dockMenu(id) {
  const tpl = [];
  if (id === 'trash') {
    const full = native.recycleBin().items > 0;
    tpl.push({ label: 'Open', click: () => apps.launch({ type: 'explorer', args: ['shell:RecycleBinFolder'] }) });
    tpl.push({ type: 'separator' });
    tpl.push({ label: 'Empty Trash', enabled: full, click: () => (native.emptyRecycleBin(), setTimeout(sendDock, 600)) });
  } else if (id === 'downloads') {
    tpl.push({ label: 'Open "Downloads"', click: () => shell.openPath(app.getPath('downloads')) });
  } else {
    const found = apps.findItem(id);
    if (!found) return;
    const wins = apps.windowsOf(found);
    for (const w of wins.slice(0, 14)) {
      tpl.push({
        label: (w.title.length > 60 ? w.title.slice(0, 58) + '…' : w.title).replace(/&/g, '&&'),
        click: () => native.focusWindow(w.hwnd),
      });
    }
    if (wins.length) tpl.push({ type: 'separator' });
    if (found.item && found.item.id === 'finder') {
      tpl.push({ label: 'New Finder Window', click: () => apps.launch({ type: 'explorer' }) }, { type: 'separator' });
    }
    const options = [];
    if (found.item) {
      if (found.item.id !== 'finder') options.push({ label: 'Remove from Dock', click: () => apps.unpin(id) });
    } else {
      options.push({ label: 'Keep in Dock', click: () => apps.pinRunning(found.running[0].key) });
    }
    const exe =
      (found.running[0] && found.running[0].exe) ||
      (found.item && found.item.launch && found.item.launch.type === 'path' ? found.item.launch.value : null);
    if (exe) options.push({ label: 'Show in Explorer', click: () => shell.showItemInFolder(exe) });
    if (options.length) tpl.push({ label: 'Options', submenu: options }, { type: 'separator' });
    if (wins.length) {
      tpl.push({
        label: 'Show All Windows',
        click: () => wins.forEach((w) => w.minimized && native.windowOp(w.hwnd, 'restore')),
      });
      tpl.push({ label: 'Hide', click: () => apps.hideApp(found) });
      if (!found.item || found.item.id !== 'finder') tpl.push({ label: 'Quit', click: () => apps.quitApp(found) });
    } else if (found.item) {
      tpl.push({ label: 'Open', click: () => apps.launch(found.item.launch) });
    }
  }
  popupNativeMenu(tpl, dock);
}

function dockBackgroundMenu() {
  const s = settings.get('dock');
  popupNativeMenu(
    [
      { label: s.autohide ? 'Turn Hiding Off' : 'Turn Hiding On', click: () => settings.set('dock.autohide', !s.autohide) },
      {
        label: s.magnify ? 'Turn Magnification Off' : 'Turn Magnification On',
        click: () => settings.set('dock.magnify', !s.magnify),
      },
      { type: 'separator' },
      { label: 'Add App to Dock…', click: addAppDialog },
      { label: 'Dock Settings…', click: () => openPopup('settings', rightAnchor()) },
    ],
    dock
  );
}

async function addAppDialog() {
  const r = await dialog.showOpenDialog({
    title: 'Add to Dock',
    defaultPath: path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    filters: [
      { name: 'Apps', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (!r.canceled && r.filePaths[0]) apps.pinFile(r.filePaths[0]);
}

function popupNativeMenu(tpl, win) {
  const m = Menu.buildFromTemplate(tpl);
  win._menuOpen = true;
  win.webContents.send('native-menu', true);
  m.popup({
    window: win,
    callback: () => {
      if (win.isDestroyed()) return;
      win._menuOpen = false;
      win.webContents.send('native-menu', false);
    },
  });
}

const rightAnchor = () => {
  const d = cursorDisplay();
  return { x: d.bounds.width - 8, align: 'right', display: d };
};

// ---------------------------------------------------------------------------
// Widgets
// Default layout: a column in the top-right corner, clear of desktop icons.
function defaultWidgetPos(name) {
  const d = disp();
  const gap = 16;
  const x0 = d.bounds.width - 24 - 344;
  const top = MENUBAR_H + 22;
  const S = 164;
  return {
    notes: [x0 - S - gap, top],
    clock: [x0, top],
    weather: [x0 + S + gap, top],
    calendar: [x0, top + S + gap],
    system: [x0, top + 2 * (S + gap)],
  }[name];
}

function widgetBounds(name) {
  const cfg = settings.get(`widgets.${name}`);
  const [w, h] = WIDGET_SIZES[name];
  const d = disp();
  const [x, y] = cfg.x == null || cfg.y == null ? defaultWidgetPos(name) : [cfg.x, cfg.y];
  return {
    x: Math.round(d.bounds.x + x - WIDGET_PAD),
    y: Math.round(d.bounds.y + y - WIDGET_PAD),
    width: w + WIDGET_PAD * 2,
    height: h + WIDGET_PAD * 2,
  };
}

// Visible card rectangle of a widget, in display-relative coordinates.
function contentRect(name) {
  const b = widgetBounds(name);
  const d = disp();
  const [w, h] = WIDGET_SIZES[name];
  return { x: b.x - d.bounds.x + WIDGET_PAD, y: b.y - d.bounds.y + WIDGET_PAD, w, h };
}

function saveWidgetPos(name, x, y) {
  settings.set(`widgets.${name}`, { ...settings.get(`widgets.${name}`), x: Math.round(x), y: Math.round(y) });
}

// ---- Snap grid (like macOS Sonoma): columns counted from the right edge, rows from the menu bar.
const CELL = 164;
const PITCH = CELL + 16;

// Widget positions are stored relative to the primary display's origin, so they can live on
// any display; each display has its own grid (in those same coordinates).
function widgetDisplay(x, y, w = CELL, h = CELL) {
  const P = disp().bounds;
  return screen.getDisplayNearestPoint({ x: Math.round(P.x + x + w / 2), y: Math.round(P.y + y + h / 2) });
}

function gridFrame(d = disp()) {
  const P = disp().bounds;
  const ox = d.bounds.x - P.x;
  const oy = d.bounds.y - P.y;
  const R = ox + d.bounds.width - 24;
  const T = oy + (menubars.has(d.id) ? MENUBAR_H : 0) + 22;
  const bottom = d.workArea.y - P.y + d.workArea.height - 24;
  return {
    R,
    T,
    cols: Math.max(1, Math.floor((d.bounds.width - 48 + 16) / PITCH)),
    rows: Math.max(1, Math.floor((bottom - T + 16) / PITCH)),
  };
}
const cellsFor = (name) => WIDGET_SIZES[name].map((v) => Math.round((v + 16) / PITCH));
function slotToPos(name, k, row, g) {
  return [g.R - CELL - (k + cellsFor(name)[0] - 1) * PITCH, g.T + row * PITCH];
}

function occupiedCells(except, g) {
  const occ = new Set();
  for (const n of Object.keys(WIDGET_SIZES)) {
    if (n === except || !settings.get(`widgets.${n}.on`)) continue;
    const r = contentRect(n);
    for (let row = 0; row < g.rows; row++) {
      for (let k = 0; k < g.cols; k++) {
        const cx = g.R - CELL - k * PITCH;
        const cy = g.T + row * PITCH;
        if (r.x < cx + CELL - 8 && cx < r.x + r.w - 8 && r.y < cy + CELL - 8 && cy < r.y + r.h - 8) occ.add(`${k},${row}`);
      }
    }
  }
  return occ;
}

function slotFree(occ, k, row, cw, ch) {
  for (let i = 0; i < cw; i++) for (let j = 0; j < ch; j++) if (occ.has(`${k + i},${row + j}`)) return false;
  return true;
}

function clampToScreen(name, x, y) {
  const [w, h] = WIDGET_SIZES[name];
  const d = widgetDisplay(x, y, w, h);
  const P = disp().bounds;
  const ox = d.bounds.x - P.x;
  const oy = d.bounds.y - P.y;
  return [
    Math.max(ox + 8, Math.min(x, ox + d.bounds.width - w - 8)),
    Math.max(oy + MENUBAR_H + 8, Math.min(y, oy + d.bounds.height - h - 8)),
  ];
}

// Nearest free grid slot to (x, y); other widgets are never overlapped.
function snapToGrid(name, x, y) {
  const [ww, hh] = WIDGET_SIZES[name];
  const g = gridFrame(widgetDisplay(x, y, ww, hh));
  const [cw, ch] = cellsFor(name);
  const occ = occupiedCells(name, g);
  let best = null;
  let bestD = Infinity;
  for (let row = 0; row <= g.rows - ch; row++) {
    for (let k = 0; k <= g.cols - cw; k++) {
      if (!slotFree(occ, k, row, cw, ch)) continue;
      const [px, py] = slotToPos(name, k, row, g);
      const dd = (px - x) ** 2 + (py - y) ** 2;
      if (dd < bestD) {
        bestD = dd;
        best = [px, py];
      }
    }
  }
  return best || clampToScreen(name, x, y);
}

function animateWindow(win, tx, ty, done) {
  if (win._anim) clearInterval(win._anim);
  const b = win.getBounds();
  const sx = b.x;
  const sy = b.y;
  const t0 = Date.now();
  const D = 220;
  win._anim = setInterval(() => {
    if (win.isDestroyed()) return clearInterval(win._anim);
    const t = Math.min(1, (Date.now() - t0) / D);
    // easeOutBack: a tiny overshoot so the widget visibly "clicks" into place
    const c = 1.4;
    const e = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
    win.setPosition(Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
    if (t >= 1) {
      clearInterval(win._anim);
      win._anim = null;
      if (done) done();
    }
  }, 8);
}

function moveWidgetTo(name, x, y) {
  const win = widgets[name];
  saveWidgetPos(name, x, y);
  if (!win || win.isDestroyed()) return;
  const d = disp();
  animateWindow(win, d.bounds.x + Math.round(x) - WIDGET_PAD, d.bounds.y + Math.round(y) - WIDGET_PAD, () =>
    native.sendToDesktop(native.hwndOf(win))
  );
}

// Pack all enabled widgets into the top-right corner, three columns wide (the default look).
function arrangeWidgets() {
  const g = gridFrame();
  const occ = new Set();
  const order = ['weather', 'clock', 'notes', 'calendar', 'system', ...Object.keys(WIDGET_SIZES)].filter(
    (n, i, a) => a.indexOf(n) === i && WIDGET_SIZES[n] && settings.get(`widgets.${n}.on`)
  );
  for (const name of order) {
    const [cw, ch] = cellsFor(name);
    let placed = null;
    for (const band of [Math.min(3, g.cols), g.cols]) {
      for (let row = 0; row <= g.rows - ch && !placed; row++) {
        for (let k = 0; k <= band - cw && !placed; k++) {
          if (slotFree(occ, k, row, cw, ch)) placed = [k, row];
        }
      }
      if (placed) break;
    }
    if (!placed) continue;
    for (let i = 0; i < cw; i++) for (let j = 0; j < ch; j++) occ.add(`${placed[0] + i},${placed[1] + j}`);
    const [x, y] = slotToPos(name, placed[0], placed[1], g);
    moveWidgetTo(name, x, y);
  }
}

// ---- Dragging: we move the window ourselves so it can lift, snap and animate.
let wdrag = null;

function startWidgetDrag(name) {
  const win = widgets[name];
  if (!win || win.isDestroyed() || wdrag) return;
  if (win._anim) clearInterval(win._anim);
  const cur = screen.getCursorScreenPoint();
  const b = win.getBounds();
  wdrag = { name, win, dx: cur.x - b.x, dy: cur.y - b.y };
  win.setAlwaysOnTop(true, 'floating');
  win.webContents.send('widget:drag', true);
  wdrag.timer = setInterval(() => {
    if (!wdrag) return;
    if (!native.primaryButtonDown()) return endWidgetDrag();
    const p = screen.getCursorScreenPoint();
    const nb = wdrag.win.getBounds();
    const nx = p.x - wdrag.dx;
    const ny = p.y - wdrag.dy;
    if (nb.x !== nx || nb.y !== ny) wdrag.win.setPosition(nx, ny);
  }, 8);
}

function endWidgetDrag() {
  if (!wdrag) return;
  const { name, win, timer } = wdrag;
  clearInterval(timer);
  wdrag = null;
  if (win.isDestroyed()) return;
  const d = disp();
  const b = win.getBounds();
  let x = b.x - d.bounds.x + WIDGET_PAD;
  let y = b.y - d.bounds.y + WIDGET_PAD;
  [x, y] = settings.get('appearance.snapWidgets') ? snapToGrid(name, x, y) : clampToScreen(name, x, y);
  saveWidgetPos(name, x, y);
  win.webContents.send('widget:drag', false);
  animateWindow(win, d.bounds.x + x - WIDGET_PAD, d.bounds.y + y - WIDGET_PAD, () => {
    win.setAlwaysOnTop(false);
    native.sendToDesktop(native.hwndOf(win));
  });
}

function createWidget(name) {
  // A widget switched back on may land on top of one that was moved there meanwhile.
  if (settings.get('appearance.snapWidgets')) {
    const r = contentRect(name);
    const g = gridFrame(widgetDisplay(r.x, r.y, r.w, r.h));
    const occ = occupiedCells(name, g);
    const [cw, ch] = cellsFor(name);
    const k = Math.round((g.R - CELL - r.x) / PITCH) - (cw - 1);
    const row = Math.round((r.y - g.T) / PITCH);
    if (!slotFree(occ, k, row, cw, ch)) saveWidgetPos(name, ...snapToGrid(name, r.x, r.y));
  }
  const win = makeWin('widgets', { ...widgetBounds(name), focusable: true, alwaysOnTop: false, movable: true }, { w: name });
  glassSubscribe(win);
  const hwnd = native.hwndOf(win);
  win.once('ready-to-show', () => {
    win.showInactive();
    native.sendToDesktop(hwnd);
  });
  win.on('focus', () =>
    setTimeout(() => !win.isDestroyed() && !(wdrag && wdrag.win === win) && !win._anim && native.sendToDesktop(hwnd), 40)
  );
  win.on('closed', () => delete widgets[name]);
  widgets[name] = win;
}

function widgetMenu(name, win) {
  const tpl = [];
  if (name === 'weather') {
    const u = settings.get('widgets.weather.units');
    const setU = (v) => () => settings.set('widgets.weather.units', v);
    tpl.push(
      { label: 'Change Location…', click: () => win.webContents.send('widget:edit') },
      {
        label: 'Units',
        submenu: [
          { label: 'Automatic', type: 'radio', checked: u === 'auto', click: setU('auto') },
          { label: 'Celsius (°C)', type: 'radio', checked: u === 'c', click: setU('c') },
          { label: 'Fahrenheit (°F)', type: 'radio', checked: u === 'f', click: setU('f') },
        ],
      },
      { type: 'separator' }
    );
  }
  if (name === 'notes') {
    tpl.push(
      {
        label: 'Clear Note',
        click: () => {
          settings.set('widgets.notes.text', '');
          win.webContents.send('widget:set-text', '');
        },
      },
      { type: 'separator' }
    );
  }
  const snap = !!settings.get('appearance.snapWidgets');
  const glass = settings.get('appearance.widgetStyle') !== 'classic';
  tpl.push(
    { label: 'Arrange Widgets', click: arrangeWidgets },
    { label: 'Snap to Grid', type: 'checkbox', checked: snap, click: () => settings.set('appearance.snapWidgets', !snap) },
    {
      label: 'Style',
      submenu: [
        { label: 'Liquid Glass', type: 'radio', checked: glass, click: () => settings.set('appearance.widgetStyle', 'glass') },
        { label: 'Classic', type: 'radio', checked: !glass, click: () => settings.set('appearance.widgetStyle', 'classic') },
      ],
    },
    { type: 'separator' },
    { label: 'Edit Widgets…', click: () => openPopup('settings', rightAnchor()) },
    { label: 'Remove Widget', click: () => settings.set(`widgets.${name}.on`, false) }
  );
  popupNativeMenu(tpl, win);
}

function syncWidgets() {
  for (const name of Object.keys(WIDGET_SIZES)) {
    const on = settings.get(`widgets.${name}.on`);
    if (on && !widgets[name]) createWidget(name);
    if (!on && widgets[name]) widgets[name].destroy();
  }
}

// ---------------------------------------------------------------------------
// Spotlight & Launchpad
function createSpotlight() {
  spotlight = makeWin('spotlight', { width: 720, height: 110, focusable: true, alwaysOnTop: true });
  glassSubscribe(spotlight);
  spotlight.setAlwaysOnTop(true, 'screen-saver');
  spotlight.on('blur', () => spotlight.hide());
}

function toggleSpotlight() {
  if (!spotlight) return;
  if (spotlight.isVisible() && spotlight.isFocused()) {
    spotlight.hide();
    return;
  }
  hidePopup();
  const d = cursorDisplay();
  const b = spotlight.getBounds();
  spotlight.setBounds({
    x: Math.round(d.bounds.x + (d.bounds.width - b.width) / 2),
    y: Math.round(d.bounds.y + d.bounds.height * 0.2),
    width: b.width,
    height: b.height,
  });
  sendPos(spotlight);
  spotlight.webContents.send('spotlight:show');
  spotlight.show();
  spotlight.focus();
  setTimeout(() => {
    if (!spotlight.isFocused()) native.focusWindow(native.hwndOf(spotlight));
  }, 60);
}

// Launchpad is a full-screen window full of icons: made when first opened and thrown away
// a while after it closes, so it costs nothing the rest of the time.
let launchpadIdle = null;
function createLaunchpad() {
  const win = makeWin('launchpad', { ...cursorDisplay().bounds, focusable: true, alwaysOnTop: true });
  launchpad = win;
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.on('blur', () => win.isVisible() && win.hide());
  win.on('show', () => clearTimeout(launchpadIdle));
  win.on('hide', () => {
    clearTimeout(launchpadIdle);
    launchpadIdle = setTimeout(() => !win.isDestroyed() && !win.isVisible() && win.destroy(), 90000);
  });
  win.on('closed', () => {
    if (launchpad === win) launchpad = null;
  });
}

function toggleLaunchpad() {
  if (!launchpad || launchpad.isDestroyed()) {
    createLaunchpad();
    launchpad.webContents.once('did-finish-load', () => setTimeout(openLaunchpad, 40));
    return;
  }
  if (launchpad.isVisible()) {
    launchpad.webContents.send('launchpad:close');
    return;
  }
  openLaunchpad();
}

function openLaunchpad() {
  if (!launchpad || launchpad.isDestroyed()) return;
  hidePopup();
  hideStart();
  if (spotlight && spotlight.isVisible()) spotlight.hide();
  launchpad.setBounds(cursorDisplay().bounds);
  sendPos(launchpad);
  if (!glassFrame) launchpad.webContents.send('wallpaper');
  launchpad.webContents.send('launchpad:show');
  launchpad.show();
  launchpad.focus();
  setTimeout(() => {
    if (!launchpad.isFocused()) native.focusWindow(native.hwndOf(launchpad));
    if (dock && !dock.isDestroyed()) dock.moveTop();
  }, 60);
}

// ---------------------------------------------------------------------------
// Windows taskbar & login item
function applyTaskbar() {
  const want = settings.get('hideTaskbar');
  const tb = settings.get('_taskbar') || {};
  if (want) {
    if (!tb.hiddenByUs) settings.set('_taskbar', { hiddenByUs: true, originalState: native.taskbarGetState() });
    native.taskbarSetState(1); // ABS_AUTOHIDE frees the work area
    native.taskbarShow(false);
  } else if (tb.hiddenByUs) {
    restoreTaskbar();
  }
}

function restoreTaskbar() {
  const tb = settings.get('_taskbar') || {};
  if (!tb.hiddenByUs) return;
  native.taskbarShow(true);
  native.taskbarSetState(tb.originalState == null ? 2 : tb.originalState);
  settings.set('_taskbar', { hiddenByUs: false, originalState: tb.originalState });
}

function applyLogin() {
  const args = app.isPackaged ? [] : [path.resolve(ROOT, '..')];
  app.setLoginItemSettings({ openAtLogin: !!settings.get('openAtLogin'), path: process.execPath, args });
}

// ---------------------------------------------------------------------------
// Actions from menus / Control Center
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function refocusTarget() {
  const fg = apps.lastFg;
  if (fg && native.windowAlive(fg.hwnd)) {
    native.focusWindow(fg.hwnd);
    await delay(90);
  }
}

function currentGroup() {
  const fg = apps.lastFg;
  if (!fg) return null;
  return apps.running.find((g) => g.windows.some((w) => w.hwnd === fg.hwnd)) || null;
}

async function confirmBox(message, button) {
  const r = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', button],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: 'Mac Desktop',
    message,
  });
  return r.response === 1;
}

async function power(op) {
  const detached = (cmd, args) => spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  switch (op) {
    case 'sleep':
      native.sleep();
      break;
    case 'lock':
      native.lock();
      break;
    case 'restart':
      if (await confirmBox('Are you sure you want to restart your computer now?', 'Restart')) {
        cleanup();
        detached('shutdown', ['/r', '/t', '0']);
      }
      break;
    case 'shutdown':
      if (await confirmBox('Are you sure you want to shut down your computer now?', 'Shut Down')) {
        cleanup();
        detached('shutdown', ['/s', '/t', '0']);
      }
      break;
    case 'logout':
      if (await confirmBox('Are you sure you want to quit all applications and log out now?', 'Log Out')) {
        cleanup();
        detached('shutdown', ['/l']);
      }
      break;
  }
}

async function doAction(a) {
  if (!a || !a.type) return;
  hidePopup();
  hideStart();
  switch (a.type) {
    case 'keys':
      await refocusTarget();
      native.sendKeys(a.keys);
      break;
    case 'media':
      native.sendKeys(a.key);
      break;
    case 'winop': {
      const fg = apps.lastFg;
      if (fg) native.windowOp(fg.hwnd, a.op);
      break;
    }
    case 'app': {
      const g = currentGroup();
      if (a.op === 'hide' && g) g.windows.forEach((w) => native.windowOp(w.hwnd, 'minimize'));
      if (a.op === 'hideOthers')
        apps.running.filter((x) => x !== g).forEach((x) => x.windows.forEach((w) => native.windowOp(w.hwnd, 'minimize')));
      if (a.op === 'showAll')
        apps.running.forEach((x) => x.windows.forEach((w) => w.minimized && native.windowOp(w.hwnd, 'restore')));
      if (a.op === 'quit' && g && !foregroundInfo().finder) g.windows.forEach((w) => native.windowOp(w.hwnd, 'close'));
      break;
    }
    case 'launch':
      apps.launch(a.spec);
      break;
    case 'folder':
      shell.openPath(app.getPath(a.which));
      break;
    case 'uri':
      if (/^(https?|ms-settings|ms-windows-store|mailto|ms-photos):/i.test(a.value)) shell.openExternal(a.value);
      break;
    case 'power':
      power(a.op);
      break;
    case 'open':
      if (a.what === 'spotlight') toggleSpotlight();
      if (a.what === 'launchpad') toggleLaunchpad();
      if (a.what === 'settings') setTimeout(() => openPopup('settings', rightAnchor()), 50);
      if (a.what === 'start') setTimeout(toggleStart, 50);
      if (a.what === 'about') setTimeout(() => openPopup('about', { center: true }), 50);
      if (a.what === 'wallpaper') setTimeout(() => openPopup('wallpaper', { center: true }), 50);
      if (a.what === 'taskmgr') spawn('taskmgr.exe', [], { detached: true, stdio: 'ignore' }).unref();
      break;
    case 'emptyTrash':
      native.emptyRecycleBin();
      setTimeout(sendDock, 600);
      break;
    case 'quit':
      app.quit();
      break;
  }
}

// ---------------------------------------------------------------------------
// Wallpaper (blurred backdrop for glass surfaces)
let wallpaperUrl = null;
function wallpaperSource() {
  const t = path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Themes\\TranscodedWallpaper');
  return fs.existsSync(t) ? t : null;
}

function buildWallpaper() {
  const src = wallpaperSource();
  if (!src) {
    wallpaperUrl = null;
    return;
  }
  try {
    const img = nativeImage.createFromBuffer(fs.readFileSync(src));
    if (img.isEmpty()) throw new Error('empty');
    const small = img.resize({ width: 640, quality: 'good' });
    const out = path.join(app.getPath('userData'), 'wallpaper-small.jpg');
    fs.writeFileSync(out, small.toJPEG(88));
    wallpaperUrl = require('url').pathToFileURL(out).href + '?v=' + Date.now();
  } catch (e) {
    console.warn('[wallpaper]', e.message);
    wallpaperUrl = null;
  }
  setTimeout(collectGarbage, 50); // the decoded desktop picture can be large
}

// The main process' JS heap is tiny, so V8 seldom collects — and every snapshot below is a
// full-span bitmap (tens of MB of native memory) that lives until it does. Collect now.
let collectGarbage = () => {};
try {
  require('v8').setFlagsFromString('--expose-gc');
  collectGarbage = require('vm').runInNewContext('gc');
} catch {
  /* not available: memory is still released, just later */
}

// The live wallpaper hands us a frame now and then (still image for the classic frosted
// style, Launchpad and as the glass fallback).
function setGlassFromImage(img, frame) {
  try {
    const out = path.join(app.getPath('userData'), 'wallpaper-small.jpg');
    fs.writeFileSync(out, img.resize({ width: Math.min(1600, Math.round(img.getSize().width / 2)), quality: 'good' }).toJPEG(88));
    glassFrame = frame || null;
    wallpaperUrl = require('url').pathToFileURL(out).href + '?v=' + Date.now();
    broadcast('wallpaper');
  } catch (e) {
    console.warn('[wallpaper] snapshot', e.message);
  }
  setTimeout(collectGarbage, 50);
}

// ---------------------------------------------------------------------------
// Pollers
function pollForeground() {
  const fg = native.foreground();
  if (!fg || fg.own) return;
  const prev = apps.lastFg;
  apps.lastFg = fg;
  if (!prev || prev.hwnd !== fg.hwnd || prev.title !== fg.title) sendMenubars('foreground', foregroundInfo());
  // A fullscreen app (game, video, F11) hides the menu bar and dock on *its* display only.
  let fsId = null;
  for (const d of screen.getAllDisplays()) {
    if (native.isFullscreen(fg.hwnd, screen.dipToScreenRect(null, d.bounds))) fsId = d.id;
  }
  if (fsId !== fullscreenDisplay) {
    fullscreenDisplay = fsId;
    for (const [id, w] of menubars) {
      if (w.isDestroyed()) continue;
      if (id === fsId) w.hide();
      else {
        placeMenubar(w, displayById(id));
        w.showInactive();
      }
    }
    if (dock && !dock.isDestroyed()) {
      if (dockDisplay().id === fsId) dock.hide();
      else {
        dock.setBounds(dockBounds());
        dock.showInactive();
      }
    }
    if (fsId != null) hidePopup();
    if (liveWall) liveWall.setFullscreen(fsId != null);
    barRevealed = false;
  }
}

// Over a fullscreen app the menu bar is hidden, like on a Mac — and like on a Mac it
// slides in when the pointer rests against the top edge, and leaves again after.
let barRevealed = false;
let edgeSince = 0;
let awaySince = 0;
function pollBarReveal() {
  if (fullscreenDisplay == null) return;
  const w = menubars.get(fullscreenDisplay);
  const d = displayById(fullscreenDisplay);
  if (!w || w.isDestroyed() || !d) return;
  const p = screen.getCursorScreenPoint();
  const onDisplay = p.x >= d.bounds.x && p.x < d.bounds.x + d.bounds.width && p.y >= d.bounds.y && p.y < d.bounds.y + d.bounds.height;
  const now = Date.now();
  if (!barRevealed) {
    // Only for a pointer that rests on the very top edge: never while a button is held
    // (dragging, a game's edge-scrolling) and never in games that hide the pointer.
    if (onDisplay && p.y <= d.bounds.y + 1 && !native.primaryButtonDown() && native.cursorVisible()) {
      if (!edgeSince) edgeSince = now;
      if (now - edgeSince > 450) {
        barRevealed = true;
        awaySince = 0;
        placeMenubar(w, d);
        w.showInactive();
        w.moveTop();
      }
    } else edgeSince = 0;
    return;
  }
  const near = onDisplay && p.y < d.bounds.y + MENUBAR_H + 30;
  const menuOpen = popupKind && popup && popup.isVisible();
  if (near || menuOpen) awaySince = 0;
  else if (!awaySince) awaySince = now;
  else if (now - awaySince > 600) {
    barRevealed = false;
    edgeSince = 0;
    w.hide();
  }
}

let lastTrash = null;
function pollSlow() {
  const full = native.recycleBin().items > 0;
  if (full !== lastTrash) {
    lastTrash = full;
    sendDock();
  }
  if (settings.get('hideTaskbar')) native.taskbarShow(false);
  checkReserve();
  broadcast('power', native.powerStatus());
}

// ---------------------------------------------------------------------------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ROOT, '..', 'build', 'icon.ico')));
  tray.setToolTip('Mac Desktop');
  const rebuild = () =>
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Start Menu', click: toggleStart },
        { label: 'Spotlight Search', accelerator: shortcut || undefined, click: toggleSpotlight },
        { label: 'Launchpad', click: toggleLaunchpad },
        { label: 'Wallpaper…', click: () => openPopup('wallpaper', { center: true }) },
        { label: 'Desktop Settings…', click: () => openPopup('settings', rightAnchor()) },
        { type: 'separator' },
        {
          label: 'Live Wallpaper',
          type: 'checkbox',
          checked: !!settings.get('wallpaper.on'),
          click: (mi) => settings.set('wallpaper.on', mi.checked),
        },
        {
          label: 'Hide Windows Taskbar',
          type: 'checkbox',
          checked: !!settings.get('hideTaskbar'),
          click: (mi) => settings.set('hideTaskbar', mi.checked),
        },
        { type: 'separator' },
        { label: 'Quit Mac Desktop', click: () => app.quit() },
      ])
    );
  rebuild();
  settings.onChange((p) => (p === 'hideTaskbar' || p === 'wallpaper.on') && rebuild());
  tray.on('click', toggleSpotlight);
}

// ---------------------------------------------------------------------------
const SETTABLE =
  /^(dock\.(autohide|magnify|size|magnifyScale)|menubar\.\w+|widgets\.\w+(\.\w+)?|appearance\.\w+|wallpaper\.\w+|startMenu\.(winKey|recent)|hideTaskbar|openAtLogin)$/;

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.publicView());
  ipcMain.handle('settings:set', (_e, p, v) => {
    if (SETTABLE.test(p)) settings.set(p, v);
  });
  ipcMain.handle('wallpaper:get', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const b = win ? win.getBounds() : disp().bounds;
    const F = frameFor(b);
    return {
      url: wallpaperUrl,
      live: !!(liveWall && liveWall.running),
      screen: { w: F.width, h: F.height },
      win: { x: b.x - F.x, y: b.y - F.y },
    };
  });
  ipcMain.handle('foreground:get', () => foregroundInfo());
  ipcMain.handle('sys:stats', () => system.stats());
  ipcMain.handle('sys:power', () => native.powerStatus());
  ipcMain.handle('sys:weather', (_e, city, units) => system.weather(city, units));
  ipcMain.handle('sys:about', () => system.about());
  ipcMain.handle('sys:wifi', () => system.wifi());
  ipcMain.handle('sys:volume', () => helper.call('volume.get').catch(() => null));
  ipcMain.handle('sys:volume:set', (_e, level) => helper.call('volume.set', { level }).catch(() => null));
  ipcMain.handle('sys:mute:set', (_e, muted) => helper.call('mute.set', { muted }).catch(() => null));
  ipcMain.handle('sys:brightness', () => helper.call('brightness.get').catch(() => null));
  ipcMain.handle('sys:brightness:set', (_e, level) => helper.call('brightness.set', { level }).catch(() => null));
  ipcMain.handle('sys:shortcut', () => shortcut);

  // ---- Control Center: audio devices, app mixer, microphone, media, radios, theme, monitors
  const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const ask = (cmd, args) =>
    helper.call(cmd, args || {}, 15000).catch((e) => {
      console.warn('[helper]', cmd, e.message);
      return null;
    });
  ipcMain.handle('sys:audio:devices', async () => {
    const d = await ask('audio.devices');
    return d ? { outputs: arr(d.outputs), inputs: arr(d.inputs) } : { outputs: [], inputs: [] };
  });
  ipcMain.handle('sys:audio:default', (_e, id) => ask('audio.setDefault', { id }));
  ipcMain.handle('sys:mic', () => ask('mic.get'));
  ipcMain.handle('sys:mic:set', (_e, v) => ask('mic.set', v));
  ipcMain.handle('sys:mixer', async () => {
    const list = arr(await ask('mixer.list'));
    const self = process.execPath.toLowerCase();
    return list
      .filter((m) => !(m.exe && m.exe.toLowerCase() === self))
      .map((m) => ({
        pid: m.pid,
        level: m.level,
        muted: m.muted,
        active: m.active,
        name: m.system ? 'System Sounds' : m.name && !m.name.startsWith('@') ? m.name : m.exe ? apps.nameForExe(m.exe) : 'App',
        icon: m.exe ? apps.icons.get(m.exe) : null,
        system: m.system,
      }))
      .sort((x, y) => (x.system - y.system) || (y.active - x.active) || x.name.localeCompare(y.name));
  });
  ipcMain.handle('sys:mixer:set', (_e, v) => ask('mixer.set', v));
  ipcMain.handle('sys:media', async () => {
    const m = await ask('media.get');
    if (!m || (!m.title && !m.artist)) return null;
    const idx = m.app && apps.findIndexApp(m.app);
    return {
      title: m.title,
      artist: m.artist,
      album: m.album,
      playing: m.playing,
      app: idx ? idx.name : m.app ? m.app.replace(/\.exe$/i, '').split(/[!\\]/).pop() : '',
      art: m.art ? `data:image/jpeg;base64,${m.art}` : null,
    };
  });
  ipcMain.handle('sys:media:cmd', async (_e, cmd) => {
    const ok = await ask('media.cmd', { cmd });
    if (!ok) native.sendKeys({ prev: 'prev', next: 'next' }[cmd] || 'playpause');
  });
  ipcMain.handle('sys:radios', async () => arr(await ask('radios.get')));
  ipcMain.handle('sys:radio:set', (_e, v) => ask('radios.set', v));
  ipcMain.handle('sys:theme', () => ask('theme.get'));
  ipcMain.handle('sys:theme:set', (_e, dark) => ask('theme.set', { dark }));
  ipcMain.handle('sys:monitors', async () => {
    const list = arr(await ask('monitors.get'));
    const ds = screen.getAllDisplays();
    return list
      .filter((m) => m.ok)
      .map((m) => {
        const i = ds.findIndex((d) => {
          const r = screen.dipToScreenRect(null, d.bounds);
          return r.x === m.left && r.y === m.top;
        });
        return { index: m.index, name: m.name, label: i >= 0 ? `Display ${i + 1}${ds[i].id === disp().id ? ' (Main)' : ''}` : m.name, value: (m.cur - m.min) / Math.max(1, m.max - m.min), min: m.min, max: m.max };
      });
  });
  ipcMain.handle('sys:monitor:set', (_e, v) => ask('monitors.set', v));
  ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)));
  ipcMain.handle('act', (_e, a) => doAction(a));

  // menu bar + popup
  const senderDisplay = (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    return (w && w._displayId != null && displayById(w._displayId)) || (w ? screen.getDisplayMatching(w.getBounds()) : disp());
  };
  ipcMain.on('menu:toggle', (e, { kind, x, align }) => {
    const display = senderDisplay(e);
    if (popupKind === kind && popup.isVisible() && popupAnchor.display && popupAnchor.display.id === display.id) hidePopup();
    else openPopup(kind, { x, align, display });
  });
  ipcMain.on('menu:hover', (e, { kind, x, align }) => {
    if (popupKind && popupKind !== kind && popup.isVisible()) openPopup(kind, { x, align, display: senderDisplay(e) });
  });
  ipcMain.on('menu:rects', (e, rects) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w._displayId != null) menuRects.set(w._displayId, Array.isArray(rects) ? rects : []);
  });
  ipcMain.on('popup:size', (_e, s) => sizePopup(s));
  ipcMain.on('popup:close', () => hidePopup());

  // dock
  ipcMain.handle('dock:get', () => apps.dockModel());
  ipcMain.handle('dock:click', (_e, id) => {
    if (id === 'trash') return apps.launch({ type: 'explorer', args: ['shell:RecycleBinFolder'] }), { launched: false };
    if (id === 'downloads') return shell.openPath(app.getPath('downloads')), { launched: false };
    return apps.activate(id);
  });
  ipcMain.on('dock:menu', (_e, id) => dockMenu(id));
  ipcMain.on('dock:bgmenu', () => dockBackgroundMenu());
  ipcMain.on('dock:ignore', (_e, ignore) => {
    if (!dock || dock.isDestroyed()) return;
    dock.setIgnoreMouseEvents(!!ignore);
    dockInteractive = !ignore;
  });
  ipcMain.on('dock:reorder', (_e, ids) => apps.reorder(ids));

  // apps (Spotlight / Launchpad)
  ipcMain.handle('apps:list', () => apps.indexForClient());
  ipcMain.handle('start:data', () => startData());
  ipcMain.on('start:close', () => hideStart());
  ipcMain.on('start:reorder', (_e, ids) => {
    if (Array.isArray(ids)) settings.set('startMenu.pinned', ids.filter((x) => typeof x === 'string').slice(0, 60));
  });
  // only files the Start menu itself listed can be opened from it
  const recentOf = (p) => lastRecent.find((r) => r.path === p);
  ipcMain.on('start:open-file', (_e, p) => {
    if (!recentOf(p)) return;
    hideStart();
    shell.openPath(p);
  });
  ipcMain.on('start:file-menu', (e, p) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!recentOf(p) || !win) return;
    popupNativeMenu(
      [
        { label: 'Open', click: () => (hideStart(), shell.openPath(p)) },
        { label: 'Open File Location', click: () => (hideStart(), shell.showItemInFolder(p)) },
        { type: 'separator' },
        { label: 'Copy Path', click: () => clipboard.writeText(p) },
      ],
      win
    );
  });
  ipcMain.on('apps:launch', (e, id) => {
    if (startWin && e.sender === startWin.webContents) hideStart();
    apps.launchIndexApp(id);
  });
  ipcMain.on('apps:menu', (e, id) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const a = apps.findIndexApp(id);
    if (!a || !win) return;
    const pinned = (settings.get('dock.pinned') || []).some((p) => p.id === 'app:' + a.appId);
    const list = startPinned();
    const onStart = list.includes(id);
    const tpl = [
      { label: 'Open', click: () => (startWin && win === startWin && hideStart(), apps.launchIndexApp(id)) },
      { type: 'separator' },
      {
        label: onStart ? 'Unpin from Start' : 'Pin to Start',
        click: () => settings.set('startMenu.pinned', onStart ? list.filter((x) => x !== id) : [...list, id]),
      },
    ];
    if (onStart && list.indexOf(id) > 0) {
      tpl.push({ label: 'Move to Front', click: () => settings.set('startMenu.pinned', [id, ...list.filter((x) => x !== id)]) });
    }
    tpl.push({ label: pinned ? 'In Dock' : 'Add to Dock', enabled: !pinned, click: () => apps.pinIndexApp(id) });
    if (a.exe || a.lnk) {
      tpl.push({ type: 'separator' }, { label: 'Open File Location', click: () => (startWin && win === startWin && hideStart(), shell.showItemInFolder(a.lnk || a.exe)) });
    }
    popupNativeMenu(tpl, win);
  });
  ipcMain.on('spotlight:hide', () => spotlight && spotlight.hide());
  ipcMain.on('spotlight:resize', (_e, h) => {
    if (!spotlight) return;
    const b = spotlight.getBounds();
    spotlight.setBounds({ ...b, height: Math.max(80, Math.min(640, Math.round(h))) });
  });
  ipcMain.on('launchpad:hidden', () => launchpad && launchpad.hide());
  ipcMain.on('notes:save', (_e, text) => settings.set('widgets.notes.text', String(text).slice(0, 20000)));
  ipcMain.on('widget:menu', (_e, name) => widgets[name] && widgetMenu(name, widgets[name]));
  const widgetOf = (e) => Object.keys(widgets).find((n) => widgets[n].webContents === e.sender);
  ipcMain.on('widget:drag-start', (e) => {
    const n = widgetOf(e);
    if (n) startWidgetDrag(n);
  });
  ipcMain.on('widget:drag-end', (e) => {
    if (wdrag && wdrag.name === widgetOf(e)) endWidgetDrag();
  });
  ipcMain.on('widgets:arrange', () => arrangeWidgets());
}

// ---------------------------------------------------------------------------
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    if (liveWall) liveWall.stop();
  } catch {
    /* ignore */
  }
  try {
    native.appbarRemoveAll();
  } catch {
    /* ignore */
  }
  try {
    restoreTaskbar();
  } catch {
    /* ignore */
  }
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore */
  }
  settings.saveNow();
  helper.stop();
}

async function start() {
  settings = new Settings();
  if (!settings.get('dock.pinned')) settings.set('dock.pinned', defaultPinned());
  apps = new Apps(settings);

  app.setAppUserModelId('MacDesktop.Shell');
  app.on('child-process-gone', (_e, d) => console.warn('[process gone]', d.type, d.reason, d.exitCode, d.name || ''));
  buildWallpaper();
  registerIpc();
  helper.onEvent = (ev, msg) => {
    if (ev === 'winkey') toggleStart();
    else if (ev === 'audio' && liveWall) {
      audioEvents++;
      liveWall.send('wall:levels', msg);
    }
  };
  helper.start();
  applyWinKey();

  syncMenubars();
  createPopup();
  // Give the app bar a moment to shrink the work area before placing the dock.
  setTimeout(() => {
    createDock();
    syncWidgets();
    createSpotlight();
    createStart();
  }, 350);

  for (const key of ['Alt+Space', 'Control+Alt+Space']) {
    try {
      if (globalShortcut.register(key, toggleSpotlight)) {
        shortcut = key;
        break;
      }
    } catch {
      /* try next */
    }
  }

  createTray();
  applyTaskbar();
  applyLogin();

  liveWall = new LiveWallpaper({
    settings,
    preload: PRELOAD,
    rendererDir: RENDERER,
    onSnapshot: setGlassFromImage,
    onLoad: () => glassWins.forEach((w) => !w.isDestroyed() && connectGlass(w)),
    onAudio: (on) => helper.call('audio.listen', { on }).catch(() => {}),
    onStop: () => {
      glassFrame = null;
      buildWallpaper();
      broadcast('wallpaper');
    },
  });
  if (settings.get('wallpaper.on')) setTimeout(() => liveWall.start(), 600);

  settings.onChange((p) => {
    broadcastSettings();
    if (p.startsWith('dock.')) {
      if (p === 'dock.autohide' || p === 'dock.size') applyDockReserve();
      if (dock && !dock.isDestroyed()) {
        dock.setBounds(dockBounds());
        sendPos(dock);
      }
      sendDock();
    }
    if (p === 'menubar.reserve') applyReserve(true);
    if (p === 'menubar.allDisplays') {
      syncMenubars();
      applyReserve(true);
    }
    if (p === 'hideTaskbar') applyTaskbar();
    if (p === 'startMenu.winKey') applyWinKey();
    if (p.startsWith('startMenu.') && startWin && !startWin.isDestroyed() && startWin.isVisible()) {
      startWin.webContents.send('start:refresh');
    }
    if (p === 'openAtLogin') applyLogin();
    if (/^widgets\.\w+(\.on)?$/.test(p)) syncWidgets();
    if (p.startsWith('wallpaper.')) {
      liveWall.configChanged(p);
      updateGlassSubs();
    }
  });

  apps.on('running', sendDock);
  apps.on('names', sendDock);
  apps.on('icons', () => {
    sendDock();
    appsChanged();
  });
  apps.on('index', () => {
    sendDock();
    appsChanged();
  });
  apps.on('internal', (what) => what === 'launchpad' && toggleLaunchpad());
  apps.refreshIndex();

  setInterval(pollForeground, 300);
  setInterval(pollDockDisplay, 50);
  setInterval(pollDockPointer, 25);
  setInterval(keepBelowMenubar, 800);
  setInterval(pollBarReveal, 60);
  setInterval(() => apps.pollRunning(), 1000);
  setInterval(pollSlow, 3000);
  setInterval(() => apps.refreshIndex(), 10 * 60 * 1000);

  const relayout = debounce(() => {
    syncMenubars();
    applyReserve(false);
    if (!displayById(dockDisplayId)) dockDisplayId = disp().id;
    applyDockReserve();
    for (const [name, w] of Object.entries(widgets)) if (!w.isDestroyed()) w.setBounds(widgetBounds(name));
    broadcast('wallpaper');
    liveWall.displaysChanged();
    updateGlassSubs();
  }, 250);
  screen.on('display-metrics-changed', relayout);
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);

  const src = wallpaperSource();
  if (src) {
    fs.watchFile(src, { interval: 4000 }, () => {
      if (liveWall && liveWall.running) return; // glass follows the live scene instead
      buildWallpaper();
      broadcast('wallpaper');
    });
  }
}

const broadcastSettings = debounce(() => broadcast('settings', settings.publicView()), 30);
const appsChanged = debounce(() => {
  for (const w of [spotlight, launchpad]) if (w && !w.isDestroyed()) w.webContents.send('apps:changed');
}, 400);

// Tear the live wallpaper down first and give the GPU a moment to release its surfaces;
// quitting while those windows are being destroyed can leave the process hanging.
let wallReleased = false;
app.on('before-quit', (e) => {
  if (!wallReleased && liveWall && liveWall.running) {
    e.preventDefault();
    wallReleased = true;
    liveWall.stop();
    setTimeout(() => app.quit(), 450);
    return;
  }
  cleanup();
});
app.on('will-quit', cleanup);
app.on('window-all-closed', () => {});
process.on('exit', () => cleaned || cleanup());
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    cleanup();
    process.exit(0);
  });
}
