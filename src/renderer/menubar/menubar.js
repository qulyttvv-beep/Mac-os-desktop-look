const bar = document.getElementById('bar');
const menusEl = document.getElementById('menus');
const appEl = document.getElementById('appname');
const clockEl = document.getElementById('clock');
const batteryEl = document.getElementById('battery');
const wifiEl = document.getElementById('wifi');

let settings = null;
let fg = { name: 'Finder', finder: true };
let openKind = null;

document.querySelector('.logo').innerHTML = Icons.glyph('logo');
document.getElementById('search').innerHTML = Icons.glyph('search');
document.getElementById('cc').innerHTML = Icons.glyph('control');
wifiEl.innerHTML = Icons.glyph('wifi');

const MENUS_FINDER = ['File', 'Edit', 'View', 'Go', 'Window', 'Help'];
const MENUS_APP = ['File', 'Edit', 'View', 'Window', 'Help'];

function renderMenus() {
  appEl.textContent = fg.name;
  const list = fg.finder ? MENUS_FINDER : MENUS_APP;
  menusEl.innerHTML = list.map((m) => `<div class="item" data-kind="menu:${m}">${m}</div>`).join('');
  markActive();
}

// Tell the main process where each menu sits, for hover-switching while a menu is open.
function sendRects() {
  const rects = [...document.querySelectorAll('.item[data-kind]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { kind: el.dataset.kind, left: r.left, right: r.right, align: el.closest('.right') ? 'right' : 'left' };
  });
  api.send('menu:rects', rects);
}
new ResizeObserver(sendRects).observe(bar);
new MutationObserver(sendRects).observe(bar, { childList: true, subtree: true, characterData: true });

function markActive() {
  document.querySelectorAll('.item[data-kind]').forEach((el) => el.classList.toggle('active', el.dataset.kind === openKind));
}

function anchorFor(el) {
  const r = el.getBoundingClientRect();
  return el.closest('.right') ? { x: r.right, align: 'right' } : { x: r.left, align: 'left' };
}

bar.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const it = e.target.closest('.item');
  if (!it) return;
  if (it.dataset.act === 'spotlight') {
    api.invoke('act', { type: 'open', what: 'spotlight' });
    return;
  }
  if (!it.dataset.kind) return;
  api.send('menu:toggle', { kind: it.dataset.kind, ...anchorFor(it) });
});

bar.addEventListener('mouseover', (e) => {
  if (!openKind) return;
  const it = e.target.closest('.item[data-kind]');
  if (!it || it.dataset.kind === openKind) return;
  api.send('menu:hover', { kind: it.dataset.kind, ...anchorFor(it) });
});

api.on('popup:state', (k) => {
  openKind = k;
  markActive();
});

api.on('foreground', (info) => {
  fg = info;
  renderMenus();
});

// ---- clock ----
function formatClock(d) {
  const s = (settings && settings.menubar) || {};
  const parts = [];
  if (s.showDate !== false) {
    parts.push(d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).replace(/,/g, ''));
  }
  const opts = { hour: 'numeric', minute: '2-digit', hour12: !s.clock24 };
  if (s.seconds) opts.second = '2-digit';
  parts.push(d.toLocaleTimeString(undefined, opts));
  return parts.join(' ');
}

let tickTimer = null;
function tick() {
  clearTimeout(tickTimer);
  clockEl.textContent = formatClock(new Date());
  const now = Date.now();
  const s = settings && settings.menubar && settings.menubar.seconds;
  tickTimer = setTimeout(tick, s ? 1000 - (now % 1000) + 5 : 60000 - (now % 60000) + 5);
}

// ---- battery ----
function renderPower(p) {
  const show = p && p.hasBattery && (!settings || settings.menubar.showBattery !== false);
  batteryEl.hidden = !show;
  if (!show) return;
  batteryEl.innerHTML = `<span>${p.percent != null ? p.percent + '%' : ''}</span>${Icons.battery(p.percent, p.charging || p.plugged)}`;
}
api.on('power', renderPower);

// ---- network ----
async function refreshNet() {
  try {
    const w = await api.invoke('sys:wifi');
    if (w.hasWifi) wifiEl.innerHTML = Icons.glyph(w.connected ? 'wifi' : 'wifiOff');
    else wifiEl.innerHTML = Icons.glyph(navigator.onLine ? 'ethernet' : 'wifiOff');
  } catch {
    /* ignore */
  }
}
window.addEventListener('online', refreshNet);
window.addEventListener('offline', refreshNet);

// ---- contrast against wallpaper ----
function updateContrast() {
  const lum = Glass.luminance(0, 0, window.innerWidth, 28);
  bar.classList.toggle('on-light', lum > 0.62);
  bar.classList.toggle('on-dark', lum <= 0.62);
}
Glass.onChange(updateContrast);

const applyGlass = () => document.documentElement.classList.toggle('lg-on', !!(settings && settings.appearance && settings.appearance.liquidGlass));

api.on('settings', (s) => {
  settings = s;
  applyGlass();
  tick();
  api.invoke('sys:power').then(renderPower);
});

(async function init() {
  settings = await api.invoke('settings:get');
  applyGlass();
  fg = await api.invoke('foreground:get');
  renderMenus();
  tick();
  renderPower(await api.invoke('sys:power'));
  refreshNet();
  setInterval(refreshNet, 30000);
  Glass.load();
})();
