// App index (Start menu), icon cache, running-app tracking and dock model.
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const EventEmitter = require('events');
const helper = require('./helper');
const native = require('./native');

const env = process.env;
const WINDIR = env.WINDIR || 'C:\\Windows';
const KNOWN_FOLDERS = {
  '{6D809377-6AF0-444B-8957-A3773F02200E}': env.ProgramW6432 || env.ProgramFiles,
  '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}': env['ProgramFiles(x86)'],
  '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}': path.join(WINDIR, 'System32'),
  '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}': path.join(WINDIR, 'SysWOW64'),
  '{F38BF404-1D43-42F2-9305-67DE0B28FC23}': WINDIR,
  '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}': env.LOCALAPPDATA,
  '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}': env.APPDATA,
  '{5E6C858F-0E22-4760-9AFE-EA3317B67173}': env.USERPROFILE,
};
const JUNK_NAME = /\b(uninstall|uninstaller|readme|read me|release notes|license|website|documentation|changelog|manual)\b/i;
const JUNK_FILE = /\.(url|chm|txt|pdf|html?|rtf|md|ini|log|xml|json|hlp|msc)$/i;
// Admin consoles and SDK tools clutter Launchpad; they're still reachable via the Start menu.
const JUNK_LNK = /\\(Administrative Tools|Windows Tools|System Tools|Windows Kits|Accessibility)\\/i;
const JUNK_TARGET = /\\(mmc|odbcad32|perfmon|recoverydrive|msinfo32|iscsicpl|dfrgui|cleanmgr|regedt32|wf|dcomcnfg|eventvwr|compmgmtlauncher)\.exe$/i;
const FRIENDLY = {
  'explorer.exe': 'Finder',
  'applicationframehost.exe': 'App',
  'windowsterminal.exe': 'Terminal',
  'msedge.exe': 'Microsoft Edge',
  'chrome.exe': 'Google Chrome',
  'firefox.exe': 'Firefox',
  'systemsettings.exe': 'Settings',
  'calculatorapp.exe': 'Calculator',
  'notepad.exe': 'Notepad',
};

function resolveAppIdPath(appId) {
  if (!appId) return null;
  const m = /^(\{[0-9A-F-]+\})\\(.+)$/i.exec(appId);
  if (m) {
    const base = KNOWN_FOLDERS[m[1].toUpperCase()];
    return base ? path.join(base, m[2]) : null;
  }
  if (/^[a-z]:\\/i.test(appId)) return appId;
  return null;
}

const lower = (s) => (s || '').toLowerCase();
const baseOf = (p) => (p ? path.basename(p).toLowerCase() : '');

// ---------------------------------------------------------------------------
class IconCache extends EventEmitter {
  constructor() {
    super();
    this.dir = path.join(app.getPath('userData'), 'icons');
    fs.mkdirSync(this.dir, { recursive: true });
    this.ready = new Map(); // src -> url
    this.failed = new Set();
    this.queue = [];
    this.queued = new Set();
    this.running = false;
  }

  fileFor(src) {
    return path.join(this.dir, crypto.createHash('sha1').update(lower(src)).digest('hex') + '.png');
  }

  get(src) {
    if (!src) return null;
    const hit = this.ready.get(src);
    if (hit) return hit;
    const file = this.fileFor(src);
    if (fs.existsSync(file)) {
      const url = pathToFileURL(file).href;
      this.ready.set(src, url);
      return url;
    }
    if (!this.failed.has(src) && !this.queued.has(src)) {
      this.queued.add(src);
      this.queue.push(src);
      setImmediate(() => this.pump());
    }
    return null;
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 24);
        let res = [];
        try {
          res = await helper.call('icons', { items: batch.map((src) => ({ src, out: this.fileFor(src) })) }, 120000);
        } catch (e) {
          console.warn('[icons]', e.message);
        }
        if (!Array.isArray(res)) res = res ? [res] : [];
        const okSet = new Set(res.filter((r) => r && r.ok).map((r) => r.src));
        for (const src of batch) {
          this.queued.delete(src);
          if (!okSet.has(src)) this.failed.add(src);
        }
        this.emit('update');
      }
    } finally {
      this.running = false;
    }
  }
}

// ---------------------------------------------------------------------------
class Apps extends EventEmitter {
  constructor(settings) {
    super();
    this.settings = settings;
    this.icons = new IconCache();
    this.icons.on('update', () => this.emit('icons'));
    this.index = [];
    this.byAppId = new Map();
    this.byExe = new Map();
    this.running = [];
    this.runningSig = '';
    this.lastFg = null;
    this.namesFile = path.join(app.getPath('userData'), 'names.json');
    this.names = {};
    try {
      this.names = JSON.parse(fs.readFileSync(this.namesFile, 'utf8'));
    } catch {
      /* none yet */
    }
    this.describing = new Set();
  }

  // ---- Start menu index ----
  async refreshIndex() {
    let list;
    try {
      list = await helper.call('apps', {}, 120000);
    } catch (e) {
      console.warn('[apps] index failed', e.message);
      return;
    }
    if (!Array.isArray(list)) list = list ? [list] : [];
    const seen = new Set();
    const out = [];
    for (const a of list) {
      if (!a || !a.name || !a.appId) continue;
      if (JUNK_NAME.test(a.name)) continue;
      if ((a.target && JUNK_FILE.test(a.target)) || JUNK_FILE.test(a.appId)) continue;
      const admin = !!((a.lnk && JUNK_LNK.test(a.lnk)) || (a.target && JUNK_TARGET.test(a.target)));
      if (/^https?:/i.test(a.appId)) continue;
      const key = lower(a.name);
      if (seen.has(key)) continue;
      seen.add(key);
      const exe = a.target && /\.exe$/i.test(a.target) ? a.target : resolveAppIdPath(a.appId);
      out.push({
        id: a.appId,
        name: a.name,
        appId: a.appId,
        lnk: a.lnk || null,
        exe: exe || null,
        base: baseOf(exe),
        iconSrc: a.lnk || exe || `shell:AppsFolder\\${a.appId}`,
        admin,
      });
    }
    out.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' }));
    this.index = out;
    this.byAppId = new Map(out.map((a) => [lower(a.appId), a]));
    this.byExe = new Map(out.filter((a) => a.exe).map((a) => [lower(a.exe), a]));
    this.emit('index');
  }

  indexForClient() {
    return this.index.map((a) => ({ id: a.id, name: a.name, icon: this.icons.get(a.iconSrc), admin: a.admin }));
  }

  findIndexApp(id) {
    return this.byAppId.get(lower(id)) || null;
  }

  launchIndexApp(id) {
    const a = this.findIndexApp(id);
    if (!a) return;
    if (a.lnk) shell.openPath(a.lnk);
    else this.launch({ type: 'appid', value: a.appId });
  }

  // ---- names ----
  nameForExe(exe) {
    const b = baseOf(exe);
    if (FRIENDLY[b]) return FRIENDLY[b];
    const idx = this.byExe.get(lower(exe));
    if (idx) return idx.name;
    const cached = this.names[lower(exe)];
    if (cached) return cached;
    this.describe(exe);
    const stem = path.basename(exe, path.extname(exe));
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  }

  describe(exe) {
    const k = lower(exe);
    if (this.describing.has(k)) return;
    this.describing.add(k);
    helper
      .call('describe', { paths: [exe] })
      .then((res) => {
        const d = res && res[exe];
        if (d) {
          this.names[k] = d.length > 40 ? path.basename(exe, '.exe') : d;
          fs.writeFile(this.namesFile, JSON.stringify(this.names), () => {});
          this.runningSig = '';
          this.emit('names');
        } else {
          this.names[k] = path.basename(exe, path.extname(exe));
        }
      })
      .catch(() => {});
  }

  appName(w) {
    if (w.aumid) {
      const idx = this.byAppId.get(lower(w.aumid));
      if (idx) return idx.name;
      if (w.title && w.title.length < 40) return w.title.split(' - ').pop();
    }
    return this.nameForExe(w.exe);
  }

  // ---- running apps ----
  pollRunning() {
    const wins = native.listAppWindows();
    const groups = new Map();
    for (const w of wins) {
      const key = w.aumid ? 'aumid:' + lower(w.aumid) : 'exe:' + lower(w.exe);
      let g = groups.get(key);
      if (!g) {
        const idx = (w.aumid && this.byAppId.get(lower(w.aumid))) || this.byExe.get(lower(w.exe));
        g = {
          key,
          exe: w.exe,
          base: w.base,
          aumid: w.aumid,
          name: this.appName(w),
          iconSrc: idx ? idx.iconSrc : w.aumid ? `shell:AppsFolder\\${w.aumid}` : w.exe,
          windows: [],
        };
        groups.set(key, g);
      }
      g.windows.push({ hwnd: w.hwnd, title: w.title, minimized: w.minimized });
    }
    this.running = [...groups.values()];
    const sig = JSON.stringify(this.running.map((g) => [g.key, g.name, g.windows.length]));
    if (sig !== this.runningSig) {
      this.runningSig = sig;
      this.emit('running');
    }
  }

  matches(item, r) {
    const m = item.match || [];
    return m.includes(r.base) || (r.aumid && m.includes(lower(r.aumid))) || m.includes(lower(r.exe));
  }

  dockModel() {
    const pinned = this.settings.get('dock.pinned') || [];
    const used = new Set();
    const items = pinned.map((p) => {
      const rs = this.running.filter((r) => this.matches(p, r));
      rs.forEach((r) => used.add(r.key));
      return {
        id: p.id,
        name: p.name,
        svg: p.svg || null,
        icon: p.svg ? null : this.icons.get(p.iconSrc),
        running: rs.length > 0,
        pinned: true,
      };
    });
    for (const r of this.running) {
      if (used.has(r.key)) continue;
      items.push({
        id: 'run:' + r.key,
        name: r.name,
        svg: null,
        icon: this.icons.get(r.iconSrc),
        running: true,
        pinned: false,
      });
    }
    return { apps: items, trashFull: native.recycleBin().items > 0 };
  }

  findItem(id) {
    const pinned = this.settings.get('dock.pinned') || [];
    const p = pinned.find((x) => x.id === id);
    if (p) return { item: p, running: this.running.filter((r) => this.matches(p, r)) };
    if (id.startsWith('run:')) {
      const r = this.running.find((x) => 'run:' + x.key === id);
      if (r) return { item: null, running: [r] };
    }
    return null;
  }

  windowsOf(found) {
    return found.running.flatMap((r) => r.windows);
  }

  // Click on a dock icon: focus/cycle windows if running, otherwise launch.
  activate(id) {
    const found = this.findItem(id);
    if (!found) return { launched: false };
    const wins = this.windowsOf(found).filter((w) => native.windowAlive(w.hwnd));
    if (wins.length) {
      const fgHwnd = this.lastFg && this.lastFg.hwnd;
      const allMinimized = wins.every((w) => native.isMinimized(w.hwnd));
      if (!allMinimized && wins.some((w) => w.hwnd === fgHwnd)) {
        // The app is in front: clicking its icon minimizes all of its windows.
        wins.forEach((w) => native.windowOp(w.hwnd, 'minimize'));
        this.lastFg = null;
        return { launched: false, minimized: true };
      }
      // Otherwise bring all of its windows back; the one that was on top gets focus.
      for (const w of [...wins].reverse()) if (native.isMinimized(w.hwnd)) native.windowOp(w.hwnd, 'restore');
      native.focusWindow(wins[0].hwnd);
      return { launched: false };
    }
    if (found.item) {
      this.launch(found.item.launch);
      return { launched: found.item.launch.type !== 'internal' };
    }
    return { launched: false };
  }

  launch(spec) {
    if (!spec) return;
    switch (spec.type) {
      case 'internal':
        this.emit('internal', spec.value);
        break;
      case 'uri':
        shell.openExternal(spec.value).catch(() => {});
        break;
      case 'path':
        shell.openPath(spec.value).then((err) => err && console.warn('[launch]', err));
        break;
      case 'appid':
        spawn('explorer.exe', [`shell:AppsFolder\\${spec.value}`], { detached: true, stdio: 'ignore' }).unref();
        break;
      case 'explorer':
        spawn('explorer.exe', spec.args || [], { detached: true, stdio: 'ignore' }).unref();
        break;
    }
  }

  quitApp(found) {
    for (const w of this.windowsOf(found)) native.windowOp(w.hwnd, 'close');
  }

  hideApp(found) {
    for (const w of this.windowsOf(found)) native.windowOp(w.hwnd, 'minimize');
  }

  // ---- pinning ----
  pinRunning(key) {
    const r = this.running.find((x) => x.key === key);
    if (!r) return;
    const idx = (r.aumid && this.byAppId.get(lower(r.aumid))) || this.byExe.get(lower(r.exe));
    const launch = idx
      ? idx.lnk
        ? { type: 'path', value: idx.lnk }
        : { type: 'appid', value: idx.appId }
      : r.aumid
        ? { type: 'appid', value: r.aumid }
        : { type: 'path', value: r.exe };
    this.addPinned({
      id: 'pin:' + r.key,
      name: r.name,
      iconSrc: r.iconSrc,
      launch,
      match: [r.base, lower(r.aumid)].filter(Boolean),
    });
  }

  pinIndexApp(id) {
    const a = this.findIndexApp(id);
    if (!a) return;
    this.addPinned({
      id: 'app:' + a.appId,
      name: a.name,
      iconSrc: a.iconSrc,
      launch: a.lnk ? { type: 'path', value: a.lnk } : { type: 'appid', value: a.appId },
      match: [a.base, lower(a.appId)].filter(Boolean),
    });
  }

  pinFile(file) {
    let target = file;
    if (/\.lnk$/i.test(file)) {
      try {
        target = shell.readShortcutLink(file).target || file;
      } catch {
        /* keep lnk */
      }
    }
    this.addPinned({
      id: 'file:' + lower(file),
      name: path.basename(file, path.extname(file)),
      iconSrc: file,
      launch: { type: 'path', value: file },
      match: [baseOf(target)].filter((b) => b.endsWith('.exe')),
    });
  }

  addPinned(item) {
    const pinned = [...(this.settings.get('dock.pinned') || [])];
    if (pinned.some((p) => p.id === item.id)) return;
    pinned.push(item);
    this.settings.set('dock.pinned', pinned);
  }

  unpin(id) {
    const pinned = (this.settings.get('dock.pinned') || []).filter((p) => p.id !== id);
    this.settings.set('dock.pinned', pinned);
  }

  reorder(ids) {
    const pinned = this.settings.get('dock.pinned') || [];
    const byId = new Map(pinned.map((p) => [p.id, p]));
    const next = ids.map((id) => byId.get(id)).filter(Boolean);
    for (const p of pinned) if (!next.includes(p)) next.push(p);
    this.settings.set('dock.pinned', next);
  }
}

// ---------------------------------------------------------------------------
function firstExisting(paths) {
  return paths.find((p) => p && fs.existsSync(p)) || null;
}

function defaultPinned() {
  const L = env.LOCALAPPDATA || '';
  const PF = env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files';
  const PF86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const sys = path.join(WINDIR, 'System32');
  const items = [
    { id: 'finder', name: 'Finder', svg: 'finder', launch: { type: 'explorer' }, match: ['explorer.exe'] },
    { id: 'launchpad', name: 'Launchpad', svg: 'launchpad', launch: { type: 'internal', value: 'launchpad' }, match: [] },
  ];
  const browsers = [
    ['Google Chrome', [path.join(PF, 'Google\\Chrome\\Application\\chrome.exe'), path.join(PF86, 'Google\\Chrome\\Application\\chrome.exe'), path.join(L, 'Google\\Chrome\\Application\\chrome.exe')]],
    ['Brave', [path.join(PF, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'), path.join(L, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')]],
    ['Firefox', [path.join(PF, 'Mozilla Firefox\\firefox.exe'), path.join(PF86, 'Mozilla Firefox\\firefox.exe')]],
    ['Opera GX', [path.join(L, 'Programs\\Opera GX\\opera.exe')]],
    ['Microsoft Edge', [path.join(PF86, 'Microsoft\\Edge\\Application\\msedge.exe'), path.join(PF, 'Microsoft\\Edge\\Application\\msedge.exe')]],
  ];
  for (const [name, candidates] of browsers) {
    const exe = firstExisting(candidates);
    if (exe) {
      items.push({ id: 'browser', name, iconSrc: exe, launch: { type: 'path', value: exe }, match: [baseOf(exe)] });
      break;
    }
  }
  items.push({
    id: 'mail',
    name: 'Mail',
    svg: 'mail',
    launch: { type: 'uri', value: 'mailto:' },
    match: ['olk.exe', 'outlook.exe', 'hxoutlook.exe', 'thunderbird.exe'],
  });
  items.push({
    id: 'notes',
    name: 'Notes',
    svg: 'notes',
    launch: { type: 'path', value: path.join(sys, 'notepad.exe') },
    match: ['notepad.exe'],
  });
  const wt = firstExisting([path.join(L, 'Microsoft\\WindowsApps\\wt.exe')]);
  items.push({
    id: 'terminal',
    name: 'Terminal',
    svg: 'terminal',
    launch: { type: 'path', value: wt || path.join(sys, 'WindowsPowerShell\\v1.0\\powershell.exe') },
    match: ['windowsterminal.exe', 'openconsole.exe', 'powershell.exe', 'pwsh.exe', 'cmd.exe'],
  });
  items.push({
    id: 'calculator',
    name: 'Calculator',
    svg: 'calculator',
    launch: { type: 'path', value: path.join(sys, 'calc.exe') },
    match: ['calculatorapp.exe', 'calc.exe', 'calculator.exe'],
  });
  items.push({
    id: 'photos',
    name: 'Photos',
    svg: 'photos',
    launch: { type: 'uri', value: 'ms-photos:' },
    match: ['photos.exe', 'microsoft.photos.exe'],
  });
  const spotify = firstExisting([path.join(env.APPDATA || '', 'Spotify\\Spotify.exe')]);
  items.push({
    id: 'music',
    name: spotify ? 'Spotify' : 'Music',
    svg: 'music',
    launch: spotify ? { type: 'path', value: spotify } : { type: 'uri', value: 'mswindowsmusic:' },
    match: ['spotify.exe', 'microsoft.media.player.exe', 'music.ui.exe'],
  });
  items.push({
    id: 'store',
    name: 'App Store',
    svg: 'store',
    launch: { type: 'uri', value: 'ms-windows-store:' },
    match: ['winstore.app.exe'],
  });
  items.push({
    id: 'settings',
    name: 'System Settings',
    svg: 'settings',
    launch: { type: 'uri', value: 'ms-settings:' },
    match: ['systemsettings.exe'],
  });
  return items;
}

module.exports = { Apps, defaultPinned };
