// Win32 bindings via koffi (FFI). Everything degrades gracefully if koffi fails to load.
let koffi = null;
let ok = false;
const N = { ok: false };

const SW_HIDE = 0;
const SW_MAXIMIZE = 3;
const SW_MINIMIZE = 6;
const SW_SHOWNA = 8;
const SW_RESTORE = 9;
const GW_OWNER = 4;
const GW_HWNDPREV = 3;
const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const WS_CAPTION = 0x00c00000;
const WM_CLOSE = 0x10;
const SWP_NOSIZE = 0x1;
const SWP_NOMOVE = 0x2;
const SWP_NOACTIVATE = 0x10;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const DWMWA_CLOAKED = 14;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const ABM_NEW = 0;
const ABM_REMOVE = 1;
const ABM_QUERYPOS = 2;
const ABM_SETPOS = 3;
const ABM_GETSTATE = 4;
const ABM_SETSTATE = 10;
const ABE_TOP = 1;
const ABE_BOTTOM = 3;

const SKIP_CLASSES = new Set([
  'Progman',
  'WorkerW',
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'XamlExplorerHostIslandWindow',
  'NotifyIconOverflowWindow',
  'Shell_InputSwitchTopLevelWindow',
  'ForegroundStaging',
  'MultitaskingViewFrame',
  'TaskManagerWindow_hidden',
]);
const SKIP_EXES = new Set([
  'textinputhost.exe',
  'shellexperiencehost.exe',
  'searchhost.exe',
  'searchapp.exe',
  'startmenuexperiencehost.exe',
  'lockapp.exe',
  'applicationframehost.exe',
  'widgets.exe',
  'shellhost.exe',
]);

let f = {}; // raw functions
let APPBARDATA;
let SHQUERYRBINFO;
let CURSORINFO;

try {
  koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const shell32 = koffi.load('shell32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const powrprof = koffi.load('powrprof.dll');

  const RECT = koffi.struct('MD_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  APPBARDATA = koffi.struct('MD_APPBARDATA', {
    cbSize: 'uint32',
    hWnd: 'intptr_t',
    uCallbackMessage: 'uint32',
    uEdge: 'uint32',
    rc: RECT,
    lParam: 'intptr_t',
  });
  SHQUERYRBINFO = koffi.struct('MD_SHQUERYRBINFO', { cbSize: 'uint32', i64Size: 'int64', i64NumItems: 'int64' });
  const POWER = koffi.struct('MD_POWER', {
    ACLineStatus: 'uint8',
    BatteryFlag: 'uint8',
    BatteryLifePercent: 'uint8',
    SystemStatusFlag: 'uint8',
    BatteryLifeTime: 'uint32',
    BatteryFullLifeTime: 'uint32',
  });
  const EnumProc = koffi.proto('bool __stdcall MD_EnumProc(intptr_t hwnd, intptr_t lParam)');
  koffi.struct('MD_POINT', { x: 'int32', y: 'int32' });
  CURSORINFO = koffi.struct('MD_CURSORINFO', { cbSize: 'uint32', flags: 'uint32', hCursor: 'intptr_t', pt: 'MD_POINT' });

  f = {
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *pid)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hWnd, void *buf, int max)'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(intptr_t hWnd)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hWnd, void *buf, int max)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hWnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hWnd)'),
    IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hWnd)'),
    GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32_t cmd)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int idx)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int idx, intptr_t val)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ MD_RECT *rect)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t hWnd, int cmd)'),
    SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)'),
    BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(intptr_t hWnd)'),
    SetWindowPos: user32.func(
      'bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'
    ),
    PostMessageW: user32.func('bool __stdcall PostMessageW(intptr_t hWnd, uint32_t msg, uintptr_t w, intptr_t l)'),
    FindWindowW: user32.func('intptr_t __stdcall FindWindowW(str16 cls, str16 title)'),
    FindWindowExW: user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, str16 cls, str16 title)'),
    EnumWindows: user32.func('bool __stdcall EnumWindows(MD_EnumProc *proc, intptr_t lParam)'),
    EnumChildWindows: user32.func('bool __stdcall EnumChildWindows(intptr_t parent, MD_EnumProc *proc, intptr_t lParam)'),
    AttachThreadInput: user32.func('bool __stdcall AttachThreadInput(uint32_t from, uint32_t to, bool attach)'),
    GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
    keybd_event: user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)'),
    LockWorkStation: user32.func('bool __stdcall LockWorkStation()'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vk)'),
    SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
    SendMessageTimeoutW: user32.func(
      'intptr_t __stdcall SendMessageTimeoutW(intptr_t h, uint32_t msg, uintptr_t w, intptr_t l, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'
    ),
    RedrawWindow: user32.func('bool __stdcall RedrawWindow(intptr_t h, void *rect, void *rgn, uint32_t flags)'),
    WindowFromPoint: user32.func('intptr_t __stdcall WindowFromPoint(MD_POINT pt)'),
    GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t h, uint32_t flags)'),
    GetSystemMetrics: user32.func('int __stdcall GetSystemMetrics(int index)'),
    GetCursorInfo: user32.func('bool __stdcall GetCursorInfo(_Inout_ MD_CURSORINFO *info)'),
    RegisterWindowMessageW: user32.func('uint32_t __stdcall RegisterWindowMessageW(str16 name)'),
    OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)'),
    CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr_t h)'),
    QueryFullProcessImageNameW: kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, void *buf, _Inout_ uint32_t *size)'
    ),
    GetApplicationUserModelId: kernel32.func(
      'int32_t __stdcall GetApplicationUserModelId(intptr_t h, _Inout_ uint32_t *len, void *buf)'
    ),
    GetSystemPowerStatus: kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ MD_POWER *status)'),
    DwmGetWindowAttribute: dwmapi.func(
      'int32_t __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32_t attr, _Out_ int32_t *val, uint32_t size)'
    ),
    SHAppBarMessage: shell32.func('uintptr_t __stdcall SHAppBarMessage(uint32_t msg, _Inout_ MD_APPBARDATA *data)'),
    SHQueryRecycleBinW: shell32.func('int32_t __stdcall SHQueryRecycleBinW(str16 root, _Inout_ MD_SHQUERYRBINFO *info)'),
    SHEmptyRecycleBinW: shell32.func('int32_t __stdcall SHEmptyRecycleBinW(intptr_t hwnd, str16 root, uint32_t flags)'),
    SetSuspendState: powrprof.func('bool __stdcall SetSuspendState(bool hibernate, bool force, bool noWake)'),
  };
  ok = true;
} catch (e) {
  console.warn('[native] koffi unavailable, native features disabled:', e.message);
}

N.ok = ok;

function wstr(buf) {
  const s = buf.toString('utf16le');
  const i = s.indexOf('\0');
  return i >= 0 ? s.slice(0, i) : s;
}

N.hwndOf = (win) => {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
};

function className(hwnd) {
  const buf = Buffer.alloc(512);
  f.GetClassNameW(hwnd, buf, 256);
  return wstr(buf);
}

function windowTitle(hwnd) {
  const len = f.GetWindowTextLengthW(hwnd);
  if (!len) return '';
  const buf = Buffer.alloc((len + 2) * 2);
  f.GetWindowTextW(hwnd, buf, len + 1);
  return wstr(buf);
}

function windowPid(hwnd) {
  const pid = [0];
  f.GetWindowThreadProcessId(hwnd, pid);
  return pid[0];
}

const procCache = new Map();
function procInfo(pid) {
  const now = Date.now();
  const c = procCache.get(pid);
  if (c && now - c.t < 30000) return c;
  let exe = '';
  let aumid = '';
  const h = f.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (h) {
    try {
      const buf = Buffer.alloc(2080);
      const size = [1030];
      if (f.QueryFullProcessImageNameW(h, 0, buf, size)) exe = buf.toString('utf16le', 0, size[0] * 2);
      const abuf = Buffer.alloc(1040);
      const alen = [512];
      if (f.GetApplicationUserModelId(h, alen, abuf) === 0) aumid = wstr(abuf);
    } catch {
      /* ignore */
    } finally {
      f.CloseHandle(h);
    }
  }
  const info = { exe, aumid, base: exe ? exe.split('\\').pop().toLowerCase() : '', t: now };
  procCache.set(pid, info);
  if (procCache.size > 500) {
    for (const [k, v] of procCache) if (now - v.t > 30000) procCache.delete(k);
  }
  return info;
}

function isCloaked(hwnd) {
  const v = [0];
  try {
    return f.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, v, 4) === 0 && v[0] !== 0;
  } catch {
    return false;
  }
}

// For UWP frames, find the hosted CoreWindow's process.
function uwpChildPid(hwnd, framePid) {
  let found = 0;
  f.EnumChildWindows(
    hwnd,
    (child) => {
      const pid = windowPid(child);
      if (pid && pid !== framePid) {
        found = pid;
        return false;
      }
      return true;
    },
    0
  );
  return found;
}

function describeWindow(hwnd) {
  let pid = windowPid(hwnd);
  const cls = className(hwnd);
  if (cls === 'ApplicationFrameWindow') {
    const child = uwpChildPid(hwnd, pid);
    if (child) pid = child;
  }
  const p = procInfo(pid);
  return { hwnd, pid, cls, exe: p.exe, base: p.base, aumid: p.aumid };
}

// List top-level "app" windows, roughly what the Windows taskbar shows.
N.listAppWindows = () => {
  if (!ok) return [];
  const out = [];
  const own = process.pid;
  f.EnumWindows((hwnd) => {
    try {
      if (!f.IsWindowVisible(hwnd)) return true;
      if (f.GetWindow(hwnd, GW_OWNER)) return true;
      const ex = Number(f.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      if (ex & WS_EX_TOOLWINDOW) return true;
      if (ex & WS_EX_NOACTIVATE) return true;
      if (isCloaked(hwnd)) return true;
      const title = windowTitle(hwnd);
      if (!title) return true;
      const d = describeWindow(hwnd);
      if (SKIP_CLASSES.has(d.cls)) return true;
      if (d.pid === own) return true;
      if (!d.exe || SKIP_EXES.has(d.base)) return true;
      out.push({ ...d, title, minimized: f.IsIconic(hwnd) });
    } catch {
      /* skip */
    }
    return true;
  }, 0);
  return out;
};

N.foreground = () => {
  if (!ok) return null;
  const hwnd = f.GetForegroundWindow();
  if (!hwnd) return null;
  const d = describeWindow(hwnd);
  return { ...d, title: windowTitle(hwnd), own: d.pid === process.pid || windowPid(hwnd) === process.pid };
};

// Is `hwnd` covering the whole monitor with no caption (games, videos, F11)?
N.isFullscreen = (hwnd, physBounds) => {
  if (!ok || !hwnd) return false;
  const cls = className(hwnd);
  if (cls === 'Progman' || cls === 'WorkerW') return false;
  const r = {};
  if (!f.GetWindowRect(hwnd, r)) return false;
  const covers =
    r.left <= physBounds.x &&
    r.top <= physBounds.y &&
    r.right >= physBounds.x + physBounds.width &&
    r.bottom >= physBounds.y + physBounds.height;
  if (!covers) return false;
  const style = Number(f.GetWindowLongPtrW(hwnd, GWL_STYLE));
  return (style & WS_CAPTION) !== WS_CAPTION;
};

// Is the mouse pointer drawn? Games that capture the mouse hide it.
N.cursorVisible = () => {
  if (!ok) return true;
  const ci = { cbSize: koffi.sizeof(CURSORINFO), flags: 0, hCursor: 0, pt: { x: 0, y: 0 } };
  if (!f.GetCursorInfo(ci)) return true;
  return (ci.flags & 1) === 1;
};

N.windowAlive = (hwnd) => ok && !!hwnd && f.IsWindow(hwnd);
N.isZoomed = (hwnd) => ok && !!hwnd && f.IsZoomed(hwnd);
N.windowRect = (hwnd) => {
  if (!ok || !hwnd) return null;
  const r = {};
  return f.GetWindowRect(hwnd, r) ? r : null;
};
// Move/resize another app's window (physical px) without activating it or changing z-order.
N.moveWindow = (hwnd, x, y, w, h) => ok && !!hwnd && f.SetWindowPos(hwnd, 0, x, y, w, h, 0x4 | SWP_NOACTIVATE);

N.focusWindow = (hwnd) => {
  if (!ok || !hwnd) return false;
  if (f.IsIconic(hwnd)) f.ShowWindow(hwnd, SW_RESTORE);
  f.SetForegroundWindow(hwnd);
  if (f.GetForegroundWindow() === hwnd) return true;
  // Borrow the input queue of the app in front, which lets us hand the foreground over.
  const fg = f.GetForegroundWindow();
  const fgThread = fg ? f.GetWindowThreadProcessId(fg, [0]) : 0;
  const me = f.GetCurrentThreadId();
  if (fgThread && fgThread !== me && f.AttachThreadInput(me, fgThread, true)) {
    f.BringWindowToTop(hwnd);
    f.SetForegroundWindow(hwnd);
    f.AttachThreadInput(me, fgThread, false);
  }
  if (f.GetForegroundWindow() !== hwnd) {
    // Last resort: the Alt-key trick. The press is masked with an unassigned key so the app
    // in front never sees a lone Alt — that would put Chrome, Office, Explorer and many
    // games into menu mode and steal their keyboard focus.
    f.keybd_event(0x12, 0, 0, 0);
    f.keybd_event(0xe8, 0, 0, 0);
    f.keybd_event(0xe8, 0, KEYEVENTF_KEYUP, 0);
    f.SetForegroundWindow(hwnd);
    f.keybd_event(0x12, 0, KEYEVENTF_KEYUP, 0);
    f.BringWindowToTop(hwnd);
  }
  return f.GetForegroundWindow() === hwnd;
};

N.windowOp = (hwnd, op) => {
  if (!ok || !hwnd) return;
  switch (op) {
    case 'minimize':
      f.ShowWindow(hwnd, SW_MINIMIZE);
      break;
    case 'zoom':
      f.ShowWindow(hwnd, f.IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
      break;
    case 'restore':
      f.ShowWindow(hwnd, SW_RESTORE);
      break;
    case 'close':
      f.PostMessageW(hwnd, WM_CLOSE, 0, 0);
      break;
  }
};

N.isMinimized = (hwnd) => ok && f.IsIconic(hwnd);

const VK = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b,
  enter: 0x0d, esc: 0x1b, tab: 0x09, space: 0x20, backspace: 0x08, delete: 0x2e,
  left: 0x25, up: 0x26, right: 0x27, down: 0x28, home: 0x24, end: 0x23, pgup: 0x21, pgdn: 0x22,
  plus: 0xbb, minus: 0xbd, comma: 0xbc, period: 0xbe,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f11: 0x7a, f12: 0x7b,
  volmute: 0xad, voldown: 0xae, volup: 0xaf,
  next: 0xb0, prev: 0xb1, stop: 0xb2, playpause: 0xb3,
};
const EXTENDED = new Set([0x25, 0x26, 0x27, 0x28, 0x24, 0x23, 0x21, 0x22, 0x2e, 0x5b, 0xad, 0xae, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3]);

function vkOf(name) {
  if (VK[name] != null) return VK[name];
  if (name.length === 1) return name.toUpperCase().charCodeAt(0);
  return null;
}

N.sendKeys = (combo) => {
  if (!ok) return;
  const parts = combo.toLowerCase().split('+').map((s) => s.trim());
  const codes = parts.map(vkOf).filter((c) => c != null);
  if (!codes.length) return;
  const flag = (c) => (EXTENDED.has(c) ? KEYEVENTF_EXTENDEDKEY : 0);
  for (const c of codes) f.keybd_event(c, 0, flag(c), 0);
  for (const c of [...codes].reverse()) f.keybd_event(c, 0, flag(c) | KEYEVENTF_KEYUP, 0);
};

// ---- App bar (reserve screen space for the menu bar) ----
const registeredBars = new Set();
function abd(hwnd) {
  return {
    cbSize: koffi.sizeof(APPBARDATA),
    hWnd: hwnd,
    uCallbackMessage: 0x0400 + 0x1a0,
    uEdge: ABE_TOP,
    rc: { left: 0, top: 0, right: 0, bottom: 0 },
    lParam: 0,
  };
}

// Reserve a strip at the top or bottom edge (rect in physical px). Returns the rect the
// shell actually granted (it stacks us next to other app bars such as the taskbar).
N.appbarSet = (hwnd, rect, edge = 'top') => {
  if (!ok) return null;
  const d = abd(hwnd);
  if (!registeredBars.has(hwnd)) {
    f.SHAppBarMessage(ABM_NEW, d);
    registeredBars.add(hwnd);
  }
  const height = rect.bottom - rect.top;
  d.uEdge = edge === 'bottom' ? ABE_BOTTOM : ABE_TOP;
  d.rc = { ...rect };
  f.SHAppBarMessage(ABM_QUERYPOS, d);
  d.rc = edge === 'bottom' ? { ...d.rc, top: d.rc.bottom - height } : { ...d.rc, bottom: d.rc.top + height };
  f.SHAppBarMessage(ABM_SETPOS, d);
  return d.rc;
};

N.appbarRemove = (hwnd) => {
  if (!ok || !registeredBars.has(hwnd)) return;
  f.SHAppBarMessage(ABM_REMOVE, abd(hwnd));
  registeredBars.delete(hwnd);
};

// Explorer restarted: its app-bar list is gone, so ours must be registered from scratch.
N.appbarForget = (hwnd) => registeredBars.delete(hwnd);
// Broadcast to every top-level window when the taskbar (Explorer) starts.
N.taskbarCreatedMessage = () => (ok ? f.RegisterWindowMessageW('TaskbarCreated') : 0);

N.appbarRemoveAll = () => {
  for (const h of [...registeredBars]) N.appbarRemove(h);
};

// ---- Windows taskbar ----
function taskbars() {
  const list = [];
  const main = f.FindWindowW('Shell_TrayWnd', null);
  if (main) list.push(main);
  let w = 0;
  while ((w = f.FindWindowExW(0, w, 'Shell_SecondaryTrayWnd', null))) list.push(w);
  return list;
}

N.taskbarGetState = () => {
  if (!ok) return 2;
  const tb = f.FindWindowW('Shell_TrayWnd', null);
  if (!tb) return 2;
  const d = abd(tb);
  return Number(f.SHAppBarMessage(ABM_GETSTATE, d));
};

N.taskbarSetState = (state) => {
  if (!ok) return;
  const tb = f.FindWindowW('Shell_TrayWnd', null);
  if (!tb) return;
  const d = abd(tb);
  d.lParam = state;
  f.SHAppBarMessage(ABM_SETSTATE, d);
};

N.taskbarShow = (visible) => {
  if (!ok) return;
  for (const h of taskbars()) {
    const isVis = f.IsWindowVisible(h);
    if (visible && !isVis) f.ShowWindow(h, SW_SHOWNA);
    if (!visible && isVis) f.ShowWindow(h, SW_HIDE);
  }
};

// ---- Desktop-level placement for widgets ----
function desktopHost() {
  const progman = f.FindWindowW('Progman', null);
  if (progman && f.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null)) return progman;
  let w = 0;
  while ((w = f.FindWindowExW(0, w, 'WorkerW', null))) {
    if (f.FindWindowExW(w, 0, 'SHELLDLL_DefView', null)) return w;
  }
  return progman;
}

N.sendToDesktop = (hwnd) => {
  if (!ok || !hwnd) return;
  const host = desktopHost();
  const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
  if (!host) {
    f.SetWindowPos(hwnd, 1 /* HWND_BOTTOM */, 0, 0, 0, 0, flags);
    return;
  }
  const above = f.GetWindow(host, GW_HWNDPREV);
  if (!above || above === hwnd) return;
  f.SetWindowPos(hwnd, above, 0, 0, 0, 0, flags);
};

// ---- Misc ----
N.powerStatus = () => {
  if (!ok) return null;
  const s = {};
  if (!f.GetSystemPowerStatus(s)) return null;
  const hasBattery = !(s.BatteryFlag & 128) && s.BatteryFlag !== 255;
  return {
    hasBattery,
    percent: s.BatteryLifePercent === 255 ? null : s.BatteryLifePercent,
    plugged: s.ACLineStatus === 1,
    charging: !!(s.BatteryFlag & 8),
    saver: !!(s.SystemStatusFlag & 1),
  };
};

N.recycleBin = () => {
  if (!ok) return { items: 0, size: 0 };
  const info = { cbSize: koffi.sizeof(SHQUERYRBINFO), i64Size: 0, i64NumItems: 0 };
  try {
    if (f.SHQueryRecycleBinW(null, info) === 0) return { items: Number(info.i64NumItems), size: Number(info.i64Size) };
  } catch {
    /* ignore */
  }
  return { items: 0, size: 0 };
};

N.emptyRecycleBin = () => {
  if (!ok) return;
  try {
    f.SHEmptyRecycleBinW(0, null, 0);
  } catch {
    /* ignore */
  }
};

// ---- Live wallpaper: render behind the desktop icons ----
// Windows 11 24H2+: Progman hosts SHELLDLL_DefView (icons, layered) above a WorkerW that
// paints the wallpaper. Older builds use a top-level WorkerW behind the icons instead.
N.desktopWorkerW = () => {
  if (!ok) return 0;
  const progman = f.FindWindowW('Progman', null);
  if (!progman) return 0;
  const res = [0];
  f.SendMessageTimeoutW(progman, 0x052c, 0xd, 1, 0, 1000, res);
  f.SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, res);
  const child = f.FindWindowExW(progman, 0, 'WorkerW', null);
  if (child) return child;
  let found = 0;
  f.EnumWindows((h) => {
    if (f.FindWindowExW(h, 0, 'SHELLDLL_DefView', null)) found = f.FindWindowExW(0, h, 'WorkerW', null);
    return true;
  }, 0);
  return found;
};

// Re-parent `hwnd` under the wallpaper layer and place it at `rect` (physical screen px).
N.embedInDesktop = (hwnd, rect) => {
  const parent = N.desktopWorkerW();
  if (!parent) return 0;
  f.SetParent(hwnd, parent);
  const pr = {};
  f.GetWindowRect(parent, pr);
  f.SetWindowPos(hwnd, 0, rect.x - pr.left, rect.y - pr.top, rect.width, rect.height, 0x4 | SWP_NOACTIVATE);
  return parent;
};

// Keep an embedded window covering `rect` (physical px). Chromium restores the size it
// picked at creation (one display's work area) when the window is first shown, so this
// is re-applied after showing and checked now and then. Returns true if it had to fix it.
N.fitChild = (hwnd, parent, rect) => {
  if (!ok || !hwnd || !parent) return false;
  const pr = {};
  const r = {};
  f.GetWindowRect(parent, pr);
  f.GetWindowRect(hwnd, r);
  if (r.left === rect.x && r.top === rect.y && r.right - r.left === rect.width && r.bottom - r.top === rect.height) return false;
  f.SetWindowPos(hwnd, 0, rect.x - pr.left, rect.y - pr.top, rect.width, rect.height, 0x4 | SWP_NOACTIVATE);
  return true;
};

// Take a window back out of the desktop before destroying it (a child of Explorer's
// window can otherwise stall Chromium's shutdown).
N.detachFromDesktop = (hwnd) => {
  if (!ok || !hwnd) return;
  f.ShowWindow(hwnd, SW_HIDE);
  f.SetParent(hwnd, 0);
};

// Make Explorer repaint its own wallpaper after ours is removed.
N.refreshDesktop = () => {
  if (!ok) return;
  const p = N.desktopWorkerW();
  if (p) f.RedrawWindow(p, null, null, 0x1 | 0x4 | 0x80 | 0x100);
};

// Is the desktop itself (not a window) under this physical screen point?
N.isDesktopAt = (x, y) => {
  if (!ok) return false;
  const h = f.WindowFromPoint({ x: Math.round(x), y: Math.round(y) });
  if (!h) return false;
  const c = className(f.GetAncestor(h, 2 /* GA_ROOT */));
  return c === 'Progman' || c === 'WorkerW';
};

// Physical rects of visible, non-minimized app windows (for pausing hidden wallpapers).
N.appWindowRects = () =>
  N.listAppWindows()
    .filter((w) => !w.minimized)
    .map((w) => {
      const r = {};
      f.GetWindowRect(w.hwnd, r);
      return r;
    });

// Is the primary mouse button physically held? (respects swapped buttons)
N.primaryButtonDown = () => {
  if (!ok) return false;
  const swapped = f.GetSystemMetrics(23 /* SM_SWAPBUTTON */) !== 0;
  return (f.GetAsyncKeyState(swapped ? 0x02 : 0x01) & 0x8000) !== 0;
};

N.lock = () => ok && f.LockWorkStation();
N.sleep = () => ok && f.SetSuspendState(false, false, false);

module.exports = N;
