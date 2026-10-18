// Live WebGL wallpaper: ONE window spanning every display (2, 3, … monitors in any
// arrangement), embedded behind the desktop icons — so every scene, simulations
// included, is a single seamless picture. Displays that are fully covered by windows
// are skipped (scissored out) and the whole thing pauses when nothing is visible.
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const native = require('./native');

const PANORAMA = new Set(['gummy', 'flux', 'warp']);

function virtualRect() {
  const all = screen.getAllDisplays();
  const x0 = Math.min(...all.map((d) => d.bounds.x));
  const y0 = Math.min(...all.map((d) => d.bounds.y));
  const x1 = Math.max(...all.map((d) => d.bounds.x + d.bounds.width));
  const y1 = Math.max(...all.map((d) => d.bounds.y + d.bounds.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

class LiveWallpaper {
  constructor({ settings, preload, rendererDir, onSnapshot, onStop, onLoad, onAudio }) {
    this.settings = settings;
    this.preload = preload;
    this.rendererDir = rendererDir;
    this.onSnapshot = onSnapshot;
    this.onStop = onStop;
    this.onLoad = onLoad;
    this.onAudio = onAudio; // (listen: boolean) — music reactivity needs the helper's loopback
    this.audioOn = false;
    this.fullscreen = false; // a fullscreen app (game, video) is in front: go easy on the GPU
    this.win = null;
    this.parent = 0;
    this.V = null;
    this.covered = new Set();
    this.running = false;
    this.timers = [];
    this.lastMouse = { x: -1, y: -1 };
    this.wasDown = false;
    this.locked = false;
    this.snapTimer = null;

    // Accessed here (after app 'ready'), never at module load: touching powerMonitor
    // before ready leaves a native hook behind that keeps the process alive on quit.
    const { powerMonitor } = require('electron');
    powerMonitor.on('lock-screen', () => {
      this.locked = true;
      this.pollOcclusion();
    });
    powerMonitor.on('unlock-screen', () => {
      this.locked = false;
      this.pollOcclusion();
    });
  }

  get cfg() {
    return this.settings.get('wallpaper');
  }

  // The rectangle the glass UI should map the wallpaper snapshot onto (DIP).
  get frame() {
    return this.running ? this.V : null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.displaySig = this.signature();
    this.covered = new Set();
    this.create();
    this.timers.push(setInterval(() => this.pollMouse(), 16));
    this.timers.push(setInterval(() => this.pollOcclusion(), 1000));
    this.timers.push(setInterval(() => this.watchdog(), 4000));
    // The glass is fed live frames; this still-image copy only serves the classic frosted
    // style and the menu bar's contrast, so it can be rare (each one is a full-span capture).
    this.timers.push(setInterval(() => this.snapshot(), 5 * 60000));
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    clearTimeout(this.snapTimer);
    if (this.win && !this.win.isDestroyed()) {
      native.detachFromDesktop(native.hwndOf(this.win));
      this.win.destroy();
    }
    this.win = null;
    native.refreshDesktop();
    this.setAudio(false);
    if (this.onStop) this.onStop();
  }

  restart() {
    this.stop();
    if (this.cfg.on) this.start();
  }

  signature() {
    return JSON.stringify(screen.getAllDisplays().map((d) => [d.id, d.bounds, d.scaleFactor]));
  }

  create() {
    const V = (this.V = virtualRect());
    const win = new BrowserWindow({
      x: V.x,
      y: V.y,
      width: V.width,
      height: V.height,
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      // Must stay resizable: a fixed-size window is locked to the size it got at creation,
      // which Windows clamps to one display — the wallpaper never reached the others.
      resizable: true,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      thickFrame: false,
      enableLargerThanScreen: true,
      title: 'Mac Desktop Wallpaper',
      webPreferences: {
        preload: this.preload,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    this.win = win;
    win.setMenu(null);
    win.loadFile(path.join(this.rendererDir, 'wallpaper', 'index.html'));

    win.once('ready-to-show', () => {
      // Windows clamps a new window to one display, and Electron then holds it to that
      // size; sizing it through Electron (while still a normal window) lifts the limit.
      win.setBounds(V);
      const hwnd = native.hwndOf(win);
      this.parent = native.embedInDesktop(hwnd, screen.dipToScreenRect(null, V));
      if (!this.parent) native.sendToDesktop(hwnd); // fallback: lowest normal window
      win.showInactive();
      // showing snaps the window back to one display: stretch it over all of them again
      this.place();
      setTimeout(() => this.place(), 400);
      setTimeout(() => this.place(), 2000);
      this.sendConfig();
      this.scheduleSnapshot();
    });
    win.webContents.on('did-finish-load', () => {
      this.sendConfig();
      if (this.onLoad) this.onLoad();
    });
    win.webContents.on('console-message', (e) => {
      if (e.level === 'warning' || e.level === 'error') console.warn('[wallpaper]', e.message);
    });
    win.on('closed', () => {
      if (this.win === win) this.win = null;
      // Explorer restarted and took our window with it: rebuild.
      if (this.running) setTimeout(() => this.running && this.restart(), 2500);
    });
  }

  // Everything is in DIP with the origin at the bottom-left of the whole span (GL style).
  layout() {
    const V = this.V || virtualRect();
    const prim = screen.getPrimaryDisplay().bounds;
    const up = (b) => ({ x: b.x - V.x, y: V.y + V.height - (b.y + b.height), w: b.width, h: b.height });
    const displays = screen.getAllDisplays().map((d) => ({ id: d.id, ...up(d.bounds), covered: this.covered.has(d.id) }));
    const p = up(prim);
    return {
      offset: [0, 0],
      total: [V.width, V.height],
      focus: [p.x + p.w / 2, p.y + p.h / 2],
      origin: [V.x, V.y + V.height],
      displays,
      ref: screen.getPrimaryDisplay().id, // the display the scene is rendered for when not spanning
    };
  }

  // A window's rectangle (DIP) in the coordinates of the rendered frame (top-down): the
  // whole span, or — when not spanning — the primary display's frame as it is shown on
  // the window's display (same crop as the renderer's per-display copy).
  frameRect(b) {
    const V = this.V || virtualRect();
    if (this.spans()) return { x: b.x - V.x, y: b.y - V.y, w: b.width, h: b.height };
    const ref = screen.getPrimaryDisplay().bounds;
    const d = screen.getDisplayMatching(b).bounds;
    const ar = d.width / d.height / (ref.width / ref.height);
    const sx = ar > 1 ? 1 : ar;
    const sy = ar > 1 ? 1 / ar : 1;
    const fx = (x) => ((1 - sx) / 2 + ((x - d.x) / d.width) * sx) * ref.width;
    const fy = (y) => ((1 - sy) / 2 + ((y - d.y) / d.height) * sy) * ref.height;
    const x0 = fx(b.x);
    const y0 = fy(b.y);
    return { x: x0, y: y0, w: fx(b.x + b.width) - x0, h: fy(b.y + b.height) - y0 };
  }

  // Does the current scene stretch over all displays? (Panorama scenes always do; keep in
  // sync with `span: true` in the scene files.)
  spans() {
    return !!this.cfg.span || PANORAMA.has(this.cfg.scene);
  }

  setFullscreen(on) {
    if (on === this.fullscreen) return;
    this.fullscreen = on;
    this.sendConfig();
  }

  sendConfig() {
    if (!this.win || this.win.isDestroyed()) return;
    const L = this.layout();
    const paused = L.displays.every((d) => d.covered);
    this.win.webContents.send('wall:config', {
      ...this.cfg,
      // With a game or video fullscreen on one display, the others keep their wallpaper
      // but at 30 fps, leaving the GPU to the game.
      fps: this.fullscreen ? 30 : this.cfg.fps,
      layout: L,
      primary: true,
      paused,
    });
    this.setAudio(!!this.cfg.audio && !paused);
  }

  // Listen to the music only while it can be seen reacting.
  setAudio(on) {
    if (on === this.audioOn) return;
    this.audioOn = on;
    if (this.onAudio) this.onAudio(on);
  }

  configChanged(key) {
    if (key === 'wallpaper.on') {
      if (this.cfg.on) this.start();
      else this.stop();
      return;
    }
    if (!this.running) return;
    this.sendConfig();
    if (key === 'wallpaper.scene') this.scheduleSnapshot();
  }

  // Work-area changes (taskbar, menu bar) fire this too; only rebuild for real geometry changes.
  displaysChanged() {
    const sig = this.signature();
    if (sig === this.displaySig) return;
    const first = this.displaySig === undefined;
    this.displaySig = sig;
    if (this.running && !first) this.restart();
  }

  send(channel, payload) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  pollMouse() {
    if (!this.cfg.mouse || !this.win) return;
    const p = screen.getCursorScreenPoint();
    if (p.x !== this.lastMouse.x || p.y !== this.lastMouse.y) {
      this.lastMouse = p;
      this.send('wall:mouse', p);
    }
    const down = native.primaryButtonDown();
    if (down && !this.wasDown) {
      const phys = screen.dipToScreenPoint(p);
      if (native.isDesktopAt(phys.x, phys.y)) this.send('wall:click', p);
    }
    this.wasDown = down;
  }

  // A display counts as covered when one window fills it (or the session is locked).
  pollOcclusion() {
    if (!this.win) return;
    let rects = [];
    try {
      rects = native.appWindowRects();
    } catch {
      /* ignore */
    }
    // Sample each display on a coarse grid against the union of all windows, so two
    // side-by-side windows that together fill a monitor also pause it.
    const covered = new Set();
    const GX = 40;
    const GY = 24;
    for (const d of screen.getAllDisplays()) {
      if (this.locked) {
        covered.add(d.id);
        continue;
      }
      const r = screen.dipToScreenRect(null, d.bounds);
      const near = rects.filter((w) => w.right > r.x && w.left < r.x + r.width && w.bottom > r.y && w.top < r.y + r.height);
      if (!near.length) continue;
      let hit = 0;
      for (let j = 0; j < GY; j++) {
        const y = r.y + ((j + 0.5) / GY) * r.height;
        for (let i = 0; i < GX; i++) {
          const x = r.x + ((i + 0.5) / GX) * r.width;
          if (near.some((w) => x >= w.left && x < w.right && y >= w.top && y < w.bottom)) hit++;
        }
      }
      if (hit >= GX * GY * 0.97) covered.add(d.id);
    }
    const same = covered.size === this.covered.size && [...covered].every((id) => this.covered.has(id));
    if (!same) {
      this.covered = covered;
      this.sendConfig();
    }
  }

  // Cover every display (the whole virtual screen).
  place() {
    if (!this.win || this.win.isDestroyed() || !this.parent || !this.V) return;
    if (native.fitChild(native.hwndOf(this.win), this.parent, screen.dipToScreenRect(null, this.V))) {
      console.warn('[wallpaper] window was resized by the system; stretched back over all displays');
      this.scheduleSnapshot();
    }
  }

  watchdog() {
    if (this.parent && !native.windowAlive(this.parent)) return this.restart();
    this.place();
  }

  scheduleSnapshot() {
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.snapshot(), 2500);
  }

  async snapshot() {
    if (!this.win || this.win.isDestroyed() || !this.onSnapshot) return;
    if (screen.getAllDisplays().every((d) => this.covered.has(d.id))) return;
    try {
      const img = await this.win.webContents.capturePage();
      if (!img.isEmpty()) this.onSnapshot(img, this.V);
    } catch {
      /* ignore */
    }
  }
}

module.exports = { LiveWallpaper };
