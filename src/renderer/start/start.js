// Start menu: search (apps, settings, recent files, the web), pinned apps, recommended
// files, every app A–Z, account, folders and power. Opened with the Windows key.
const $ = (id) => document.getElementById(id);
const panel = $('panel');
const q = $('q');
const grid = $('grid');
const dotsEl = $('dots');
const recEl = $('rec');
const listEl = $('list');
const lettersEl = $('letters');
const resultsEl = $('results');
const homeEl = $('home');
const allEl = $('all');
const powerMenu = $('powermenu');
const lgPanel = LiquidGlass.attach(panel, { band: 18, scale: 40, pointer: true, frost: 0.75 });

// pinned apps per page: 6 × 3, or 6 × 5 when recent files are hidden
const perPage = () => (data.recent == null ? 30 : 18);
let data = { apps: [], pinned: [], recent: null, user: '' };
let all = []; // apps A–Z
let byId = new Map();
let page = 0;
let view = 'home';
let hits = []; // search results (flat, keyboard order)
let kb = -1; // keyboard-selected item in the current view
let dragging = null;

// ---------------------------------------------------------------- helpers
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
const act = (a) => api.invoke('act', a);
const uri = (value) => ({ type: 'uri', value });
const close = () => api.send('start:close');

const SVG = {
  doc: '<svg viewBox="0 0 16 16"><path d="M4 1.5h5.2L12.5 5v9.5H4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 1.7V5.3h3.4M6 8.5h4.5M6 11h4.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  download: '<svg viewBox="0 0 16 16"><path d="M8 2v8M4.5 6.8L8 10.3l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.5 11.5v2h11v-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pics: '<svg viewBox="0 0 16 16"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.6" cy="6.3" r="1.2" fill="currentColor"/><path d="M2.5 12l3.8-3.6 2.6 2.4 2-1.8 2.8 2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  web: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.8 8h12.4M8 1.8c2 2 2 10.4 0 12.4M8 1.8c-2 2-2 10.4 0 12.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  out: '<svg viewBox="0 0 16 16"><path d="M9.5 3H3.5v10h6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 8h7M11.5 5.5L14 8l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function appIcon(a) {
  return a && a.icon ? `<img src="${esc(a.icon)}" alt="" draggable="false">` : Icons.app('generic', a ? a.name : '?');
}
function fileIcon(f) {
  return f.icon ? `<img src="${esc(f.icon)}" alt="" draggable="false">` : `<span class="g">${SVG.doc}</span>`;
}
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 2 * 86400) return 'Yesterday';
  const d = new Date(t);
  if (s < 6 * 86400) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------- data
function setData(d) {
  data = d || data;
  all = (data.apps || []).filter((a) => !a.admin).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  byId = new Map(all.map((a) => [a.id, a]));
  const name = data.user || '';
  $('uname').textContent = name;
  $('av').textContent = (name.trim()[0] || '?').toUpperCase();
  homeEl.classList.toggle('no-rec', data.recent == null);
  const pages = Math.max(1, Math.ceil(pinnedApps().length / perPage()));
  if (page >= pages) page = pages - 1;
  renderHome();
  if (view === 'all') renderAll();
  if (view === 'search') search();
}
const pinnedApps = () => (data.pinned || []).map((id) => byId.get(id)).filter(Boolean);

async function load() {
  try {
    setData(await api.invoke('start:data'));
  } catch (e) {
    console.error('[start]', e);
  }
}

// ---------------------------------------------------------------- home
function renderHome() {
  const pins = pinnedApps();
  const pages = Math.max(1, Math.ceil(pins.length / perPage()));
  const slice = pins.slice(page * perPage(), (page + 1) * perPage());
  grid.innerHTML = slice.length
    ? slice
        .map((a) => `<div class="tile" draggable="true" data-id="${esc(a.id)}"><div class="ic">${appIcon(a)}</div><div class="nm">${esc(a.name)}</div></div>`)
        .join('')
    : `<div class="empty">${all.length ? 'Right-click any app and choose “Pin to Start”.' : 'Loading apps…'}</div>`;
  dotsEl.innerHTML = pages > 1 ? Array.from({ length: pages }, (_, i) => `<i class="${i === page ? 'on' : ''}"></i>`).join('') : '';
  const rec = data.recent || [];
  recEl.innerHTML = rec.length
    ? rec
        .slice(0, 6)
        .map(
          (f) =>
            `<div class="file" data-path="${esc(f.path)}" title="${esc(f.path)}"><div class="ic">${fileIcon(f)}</div><div class="tx"><div class="nm">${esc(f.name)}</div><div class="sub">${esc(ago(f.t))}${f.dir ? ' · ' + esc(f.dir) : ''}</div></div></div>`
        )
        .join('')
    : '<div class="empty">Files you open will show up here.</div>';
  markKb();
}

grid.addEventListener(
  'wheel',
  (e) => {
    const pages = Math.ceil(pinnedApps().length / perPage());
    if (pages < 2 || Math.abs(e.deltaY) < 10) return;
    const next = Math.max(0, Math.min(pages - 1, page + (e.deltaY > 0 ? 1 : -1)));
    if (next !== page) {
      page = next;
      kb = -1;
      renderHome();
    }
  },
  { passive: true }
);

// drag pinned apps to reorder them
grid.addEventListener('dragstart', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return e.preventDefault();
  dragging = t;
  t.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', t.dataset.id);
});
grid.addEventListener('dragover', (e) => {
  if (!dragging) return;
  e.preventDefault();
  const t = e.target.closest('.tile');
  if (!t || t === dragging) return;
  const r = t.getBoundingClientRect();
  grid.insertBefore(dragging, e.clientX > r.left + r.width / 2 ? t.nextSibling : t);
});
grid.addEventListener('drop', (e) => e.preventDefault());
grid.addEventListener('dragend', () => {
  if (!dragging) return;
  dragging.classList.remove('dragging');
  dragging = null;
  const ids = pinnedApps().map((a) => a.id);
  const pageIds = [...grid.querySelectorAll('.tile')].map((t) => t.dataset.id);
  ids.splice(page * perPage(), pageIds.length, ...pageIds);
  data.pinned = ids;
  api.send('start:reorder', ids);
});

// ---------------------------------------------------------------- all apps
function letterOf(name) {
  const c = (name || '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}
function renderAll() {
  let html = '';
  let letter = '';
  for (const a of all) {
    const L = letterOf(a.name);
    if (L !== letter) {
      letter = L;
      html += `<button class="letter" data-letter="${L}" id="L-${L === '#' ? 'num' : L}">${L}</button>`;
    }
    html += `<div class="row" data-id="${esc(a.id)}"><div class="ic">${appIcon(a)}</div><div class="nm">${esc(a.name)}</div></div>`;
  }
  listEl.innerHTML = html || '<div class="none">Loading apps…</div>';
  const have = new Set(all.map((a) => letterOf(a.name)));
  lettersEl.innerHTML = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
    .map((L) => `<button data-jump="${L}" ${have.has(L) ? '' : 'disabled'}>${L}</button>`)
    .join('');
}
listEl.addEventListener('click', (e) => {
  if (e.target.closest('.letter')) {
    allEl.classList.add('picking');
    lettersEl.classList.add('on');
  }
});
lettersEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-jump]');
  allEl.classList.remove('picking');
  lettersEl.classList.remove('on');
  if (!b) return;
  const el = $('L-' + (b.dataset.jump === '#' ? 'num' : b.dataset.jump));
  if (el) listEl.scrollTop = el.offsetTop - listEl.offsetTop;
});

// ---------------------------------------------------------------- search
const SETTINGS = [
  ['Display', 'display', 'screen resolution scale brightness monitor refresh rate hdr'],
  ['Night light', 'nightlight', 'blue light warm screen'],
  ['Sound', 'sound', 'volume audio speakers headphones microphone output input'],
  ['Bluetooth & devices', 'bluetooth', 'pair headphones mouse keyboard controller'],
  ['Wi-Fi', 'network-wifi', 'wireless internet network'],
  ['Network & internet', 'network', 'ethernet internet proxy'],
  ['VPN', 'network-vpn', 'private network'],
  ['Background', 'personalization-background', 'wallpaper desktop picture'],
  ['Colors', 'colors', 'dark mode light mode accent theme'],
  ['Installed apps', 'appsfeatures', 'uninstall remove programs apps features'],
  ['Default apps', 'defaultapps', 'browser open with'],
  ['Startup apps', 'startupapps', 'login boot'],
  ['Windows Update', 'windowsupdate', 'updates upgrade patch'],
  ['Storage', 'storagesense', 'disk space drive cleanup'],
  ['Power & battery', 'powersleep', 'sleep battery saver energy screen timeout'],
  ['Notifications', 'notifications', 'do not disturb focus alerts'],
  ['Mouse', 'mousetouchpad', 'pointer cursor speed scroll touchpad'],
  ['Typing & keyboard', 'typing', 'keyboard autocorrect'],
  ['Date & time', 'dateandtime', 'clock timezone'],
  ['Language & region', 'regionlanguage', 'locale format'],
  ['Your info', 'yourinfo', 'account profile picture user'],
  ['Sign-in options', 'signinoptions', 'password pin windows hello'],
  ['Privacy & security', 'privacy', 'permissions camera location'],
  ['Game Mode', 'gaming-gamemode', 'gaming performance'],
  ['Graphics', 'display-advancedgraphics', 'gpu performance'],
  ['Printers & scanners', 'printers', 'print'],
  ['About this PC', 'about', 'specs name processor ram system info'],
  ['Multitasking', 'multitasking', 'snap windows virtual desktops alt tab'],
  ['Clipboard', 'clipboard', 'history copy paste'],
].map(([name, page, kw]) => ({ kind: 'setting', name, kw, act: uri('ms-settings:' + page), g: 'gear' }));
const OWN = [
  { kind: 'setting', name: 'Desktop Settings', kw: 'mac dock menu bar widgets preferences', act: { type: 'open', what: 'settings' }, g: 'gear' },
  { kind: 'setting', name: 'Wallpaper', kw: 'live wallpaper obsidian gummy flux warp background', act: { type: 'open', what: 'wallpaper' }, g: 'sun' },
  { kind: 'setting', name: 'Launchpad', kw: 'apps grid', act: { type: 'open', what: 'launchpad' }, g: 'dock' },
  { kind: 'setting', name: 'Task Manager', kw: 'processes end task force quit', act: { type: 'open', what: 'taskmgr' }, g: 'gear' },
];

function score(name, t, kw = '') {
  const n = name.toLowerCase();
  if (n === t) return 1000;
  if (n.startsWith(t)) return 800 - n.length;
  const words = n.split(/[\s\-_.&()]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(t))) return 600 - n.length;
  if (t.length > 1 && words.map((w) => w[0]).join('').startsWith(t)) return 500 - n.length;
  if (n.includes(t)) return 400 - n.indexOf(t);
  if (kw && kw.split(' ').some((w) => w.startsWith(t))) return 300;
  return 0;
}
function rank(list, t, nameOf, kwOf) {
  return list
    .map((it) => ({ it, s: score(nameOf(it), t, kwOf ? kwOf(it) : '') }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it);
}

function search() {
  const text = q.value.trim();
  panel.classList.toggle('searching', !!q.value);
  if (!text) return show(view === 'search' ? 'home' : view);
  show('search');
  const t = text.toLowerCase();
  const appHits = rank(all, t, (a) => a.name).slice(0, 8).map((a) => ({ kind: 'app', id: a.id, name: a.name, a }));
  const setHits = rank([...OWN, ...SETTINGS], t, (s) => s.name, (s) => s.kw).slice(0, 5);
  const fileHits = rank(data.recent || [], t, (f) => f.name).slice(0, 4).map((f) => ({ kind: 'file', name: f.name, f }));
  const web = { kind: 'web', name: text };
  const best = appHits[0] || setHits[0] || fileHits[0] || null;
  hits = [];
  let html = '';
  if (best) {
    hits.push(best);
    html += `<div class="sec">Best match</div>${bestHtml(best, 0)}`;
  }
  const add = (title, list) => {
    const rest = list.filter((x) => x !== best);
    if (!rest.length) return;
    html += `<div class="sec">${title}</div>`;
    for (const it of rest) {
      html += rowHtml(it, hits.length);
      hits.push(it);
    }
  };
  add('Apps', appHits);
  add('Settings', setHits);
  add('Recent files', fileHits);
  html += '<div class="sec">Search the web</div>';
  html += rowHtml(web, hits.length);
  hits.push(web);
  resultsEl.innerHTML = html;
  kb = 0;
  markKb();
}
function iconFor(it, big) {
  if (it.kind === 'app') return `<div class="ic">${appIcon(it.a)}</div>`;
  if (it.kind === 'file') return `<div class="ic">${fileIcon(it.f)}</div>`;
  if (it.kind === 'web') return `<div class="ic"><span class="g">${SVG.web}</span></div>`;
  return `<div class="ic"><span class="g">${Icons.glyph(it.g || 'gear')}</span></div>`;
}
const KIND = { app: 'App', setting: 'Settings', file: 'File', web: 'Web' };
function bestHtml(it, i) {
  return `<div class="best" data-i="${i}">${iconFor(it, true)}<div><div class="nm">${esc(it.name)}</div><div class="kind">${KIND[it.kind]}${
    it.kind === 'file' ? ' · ' + esc(ago(it.f.t)) : ''
  }</div></div></div>`;
}
function rowHtml(it, i) {
  const name = it.kind === 'web' ? `“${esc(it.name)}” — see web results` : esc(it.name);
  return `<div class="row" data-i="${i}">${iconFor(it)}<div class="nm">${name}</div><div class="kind">${KIND[it.kind]}</div></div>`;
}

function run(it) {
  if (!it) return;
  if (it.kind === 'app') api.send('apps:launch', it.id);
  else if (it.kind === 'file') api.send('start:open-file', it.f.path);
  else if (it.kind === 'web') act(uri('https://www.google.com/search?q=' + encodeURIComponent(it.name)));
  else if (it.act) act(it.act);
}

// ---------------------------------------------------------------- views & keyboard
function show(v) {
  if (view !== v) {
    view = v;
    kb = -1;
    homeEl.classList.toggle('on', v === 'home');
    allEl.classList.toggle('on', v === 'all');
    resultsEl.classList.toggle('on', v === 'search');
    allEl.classList.remove('picking');
    lettersEl.classList.remove('on');
    if (v === 'all') {
      renderAll();
      listEl.scrollTop = 0;
    }
  }
}

// the keyboard-reachable items of the current view, in order
function kbItems() {
  if (view === 'search') return [...resultsEl.querySelectorAll('[data-i]')];
  if (view === 'all') return [...listEl.querySelectorAll('.row')];
  return [...grid.querySelectorAll('.tile'), ...recEl.querySelectorAll('.file')];
}
function markKb() {
  const els = kbItems();
  els.forEach((el, i) => el.classList.toggle('kb', i === kb));
  if (els[kb]) els[kb].scrollIntoView({ block: 'nearest' });
}
function activate(el) {
  if (!el) return;
  if (el.dataset.i != null) return run(hits[+el.dataset.i]);
  if (el.dataset.path) return api.send('start:open-file', el.dataset.path);
  if (el.dataset.id) api.send('apps:launch', el.dataset.id);
}
function move(dx, dy) {
  const els = kbItems();
  if (!els.length) return;
  if (kb < 0) {
    kb = 0;
    return markKb();
  }
  let step = dy;
  if (view === 'home') {
    const tiles = grid.querySelectorAll('.tile').length;
    if (kb < tiles) step = dx + dy * 6;
    else step = dx + dy * 2;
  } else step = dy || dx;
  kb = Math.max(0, Math.min(els.length - 1, kb + step));
  markKb();
}

document.addEventListener('keydown', (e) => {
  if (powerMenu.classList.contains('on')) {
    if (e.key === 'Escape') {
      e.preventDefault();
      togglePower(false);
    }
    return;
  }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (e.key === 'Escape') {
    e.preventDefault();
    if (lettersEl.classList.contains('on')) {
      allEl.classList.remove('picking');
      lettersEl.classList.remove('on');
    } else if (q.value) {
      q.value = '';
      search();
    } else if (view === 'all') show('home');
    else close();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const els = kbItems();
    activate(els[Math.max(0, kb)]);
  } else if (arrows[e.key]) {
    // in the search box, left/right still move the caret
    if (e.target === q && q.value && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    e.preventDefault();
    move(...arrows[e.key]);
  } else if (e.target !== q && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    q.focus();
  }
});
q.addEventListener('input', search);
$('clear').addEventListener('click', (e) => {
  e.preventDefault();
  q.value = '';
  search();
  q.focus();
});

// ---------------------------------------------------------------- mouse
function onClick(e) {
  const el = e.target.closest('.tile, .file, .row[data-id], [data-i]');
  if (el) activate(el);
}
grid.addEventListener('click', onClick);
recEl.addEventListener('click', onClick);
listEl.addEventListener('click', onClick);
resultsEl.addEventListener('click', onClick);
resultsEl.addEventListener('mousemove', (e) => {
  const el = e.target.closest('[data-i]');
  if (el && +el.dataset.i !== kb) {
    kb = +el.dataset.i;
    markKb();
  }
});
panel.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const file = e.target.closest('.file');
  if (file) return api.send('start:file-menu', file.dataset.path);
  let id = (e.target.closest('[data-id]') || {}).dataset;
  id = id && id.id;
  const r = e.target.closest('[data-i]');
  if (r) {
    const it = hits[+r.dataset.i];
    if (it && it.kind === 'app') id = it.id;
    if (it && it.kind === 'file') return api.send('start:file-menu', it.f.path);
  }
  if (id) api.send('apps:menu', id);
});

$('toAll').addEventListener('click', () => show('all'));
$('back').addEventListener('click', () => show('home'));
$('user').addEventListener('click', () => act(uri('ms-settings:yourinfo')));
$('settingsBtn').addEventListener('click', () => act(uri('ms-settings:')));
document.querySelectorAll('[data-folder]').forEach((b) => b.addEventListener('click', () => act({ type: 'folder', which: b.dataset.folder })));

function togglePower(on) {
  on = on == null ? !powerMenu.classList.contains('on') : on;
  powerMenu.classList.toggle('on', on);
  $('powerBtn').classList.toggle('on', on);
}
$('powerBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  togglePower();
});
powerMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-op]');
  if (!b) return;
  togglePower(false);
  act({ type: 'power', op: b.dataset.op });
});
document.addEventListener('mousedown', (e) => {
  if (!powerMenu.contains(e.target) && e.target !== $('powerBtn') && !$('powerBtn').contains(e.target)) togglePower(false);
  // the transparent margin around the panel counts as outside
  if (!panel.contains(e.target)) close();
});

// ---------------------------------------------------------------- open / close
// Keep the refracted wallpaper in place while the panel slides in.
let slideUntil = 0;
function followSlide() {
  LiquidGlass.updateAll();
  if (performance.now() < slideUntil) requestAnimationFrame(followSlide);
}

api.on('start:show', () => {
  q.value = '';
  panel.classList.remove('searching');
  togglePower(false);
  page = 0;
  show('home');
  kb = -1;
  renderHome();
  panel.classList.remove('open');
  void panel.offsetWidth;
  requestAnimationFrame(() => {
    panel.classList.add('open');
    slideUntil = performance.now() + 320;
    followSlide();
  });
  q.focus();
  load(); // fresh pins and recent files (shown as soon as they arrive)
});
api.on('start:hidden', () => {
  panel.classList.remove('open');
  togglePower(false);
});
api.on('start:refresh', load);
api.on('apps:changed', load);
api.on('settings', (s) => LiquidGlass.setEnabled(!!s.appearance.liquidGlass));
api.invoke('settings:get').then((s) => LiquidGlass.setEnabled(!!s.appearance.liquidGlass));

$('sg').innerHTML = Icons.glyph('search');
$('chevR').innerHTML = Icons.glyph('chevR');
$('chevL').innerHTML = Icons.glyph('chevL');
$('fDocs').innerHTML = SVG.doc;
$('fDl').innerHTML = SVG.download;
$('fPics').innerHTML = SVG.pics;
$('settingsBtn').innerHTML = Icons.glyph('gear');
$('powerBtn').innerHTML = Icons.glyph('power');
$('pLock').innerHTML = Icons.glyph('lock');
$('pSleep').innerHTML = Icons.glyph('moon');
$('pOut').innerHTML = SVG.out;
$('pRestart').innerHTML = Icons.glyph('restart');
$('pShut').innerHTML = Icons.glyph('power');
show('home');
homeEl.classList.add('on');
Glass.load();
load();
