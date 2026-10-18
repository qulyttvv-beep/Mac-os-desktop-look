const q = document.getElementById('q');
const results = document.getElementById('results');
const panel = document.getElementById('panel');
LiquidGlass.attach(panel, { band: 18, scale: 40, pointer: true, frost: 0.55 });
document.getElementById('gl').innerHTML = Icons.glyph('search');

let apps = [];
let items = [];
let sel = 0;

const S = (value) => ({ type: 'uri', value });
const COMMANDS = [
  { name: 'Lock Screen', g: 'lock', act: { type: 'power', op: 'lock' } },
  { name: 'Sleep', g: 'moon', act: { type: 'power', op: 'sleep' } },
  { name: 'Restart', g: 'power', act: { type: 'power', op: 'restart' } },
  { name: 'Shut Down', g: 'power', act: { type: 'power', op: 'shutdown' } },
  { name: 'Log Out', g: 'power', act: { type: 'power', op: 'logout' } },
  { name: 'Empty Trash', g: 'gear', act: { type: 'emptyTrash' } },
  { name: 'Launchpad', g: 'dock', act: { type: 'open', what: 'launchpad' } },
  { name: 'Start Menu', g: 'dock', kw: 'windows start apps', act: { type: 'open', what: 'start' } },
  { name: 'Wallpaper', g: 'sun', kw: 'live background obsidian liquid gummy bears jelly flux particles generative warp star trek space stars', act: { type: 'open', what: 'wallpaper' } },
  { name: 'Desktop Settings', g: 'gear', kw: 'dock widgets menu bar preferences', act: { type: 'open', what: 'settings' } },
  { name: 'About This PC', g: 'gear', kw: 'system info specs', act: { type: 'open', what: 'about' } },
  { name: 'Task Manager', g: 'gear', kw: 'force quit activity monitor', act: { type: 'open', what: 'taskmgr' } },
  { name: 'Wi-Fi Settings', g: 'wifi', kw: 'network internet', act: S('ms-settings:network-wifi') },
  { name: 'Bluetooth Settings', g: 'bluetooth', act: S('ms-settings:bluetooth') },
  { name: 'Display Settings', g: 'sun', kw: 'resolution brightness monitor', act: S('ms-settings:display') },
  { name: 'Sound Settings', g: 'speaker', kw: 'volume audio', act: S('ms-settings:sound') },
  { name: 'Wallpaper', g: 'sun', kw: 'background personalization desktop picture', act: S('ms-settings:personalization-background') },
  { name: 'Windows Update', g: 'gear', kw: 'updates', act: S('ms-settings:windowsupdate') },
  { name: 'Downloads', g: 'dock', kw: 'folder', act: { type: 'folder', which: 'downloads' } },
  { name: 'Documents', g: 'dock', kw: 'folder', act: { type: 'folder', which: 'documents' } },
  { name: 'Desktop', g: 'dock', kw: 'folder', act: { type: 'folder', which: 'desktop' } },
  { name: 'Pictures', g: 'dock', kw: 'folder photos', act: { type: 'folder', which: 'pictures' } },
  { name: 'Home Folder', g: 'dock', kw: 'user', act: { type: 'folder', which: 'home' } },
];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function score(name, query, extra = '') {
  const n = name.toLowerCase();
  const qq = query.toLowerCase();
  if (n === qq) return 1000;
  if (n.startsWith(qq)) return 800 - n.length;
  const words = n.split(/[\s\-_.()]+/).filter(Boolean);
  if (words.some((w) => w.startsWith(qq))) return 600 - n.length;
  if (words.map((w) => w[0]).join('').startsWith(qq)) return 500 - n.length;
  const idx = n.indexOf(qq);
  if (idx >= 0) return 400 - idx - n.length * 0.1;
  if (extra && extra.split(' ').some((w) => w.startsWith(qq))) return 300;
  let i = 0;
  for (const c of n) {
    if (c === qq[i]) i++;
    if (i === qq.length) return 100 - n.length * 0.5;
  }
  return 0;
}

// Small, safe arithmetic evaluator (no eval).
function calc(src) {
  const s = src.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  if (!/^[\d.+\-*/%^()]+$/.test(s) || !/\d/.test(s) || !/[+\-*/%^]/.test(s.replace(/^[-+]/, ''))) return null;
  let i = 0;
  const peek = () => s[i];
  function factor() {
    if (peek() === '-') return i++, -factor();
    if (peek() === '+') return i++, factor();
    if (peek() === '(') {
      i++;
      const v = expr();
      if (s[i] !== ')') throw new Error('paren');
      i++;
      return v;
    }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) throw new Error('num');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  function power() {
    const b = factor();
    if (peek() === '^') return i++, Math.pow(b, power());
    return b;
  }
  function term() {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = s[i++];
      const r = power();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = expr();
    return i === s.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function search() {
  const query = q.value.trim();
  items = [];
  if (!query) return render();
  const v = calc(query);
  if (v !== null) {
    const raw = String(parseFloat(v.toPrecision(14)));
    items.push({ sec: 'Calculator', kind: 'calc', name: '= ' + Number(raw).toLocaleString(undefined, { maximumFractionDigits: 10 }), raw, g: 'gear', note: 'Copy' });
  }
  const hits = apps
    .map((a) => ({ a, s: score(a.name, query) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, 8);
  hits.forEach((h, i) => items.push({ sec: i === 0 ? 'Top Hit' : 'Applications', kind: 'app', id: h.a.id, name: h.a.name, icon: h.a.icon, note: 'Application' }));
  COMMANDS.map((c) => ({ c, s: score(c.name, query, c.kw) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, 4)
    .forEach((x) => items.push({ sec: 'System', kind: 'cmd', name: x.c.name, g: x.c.g, act: x.c.act }));
  if (/^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(query)) {
    const url = /^https?:/i.test(query) ? query : 'https://' + query;
    items.push({ sec: 'Web', kind: 'url', name: url, g: 'search', url, note: 'Open' });
  }
  items.push({
    sec: 'Web',
    kind: 'web',
    name: `Search the web for “${query}”`,
    g: 'search',
    url: 'https://www.google.com/search?q=' + encodeURIComponent(query),
  });
  sel = 0;
  render();
}

function iconFor(it) {
  if (it.kind === 'app') return it.icon ? `<img src="${it.icon}" alt="">` : Icons.app('generic', it.name);
  return `<div class="g">${Icons.glyph(it.g)}</div>`;
}

function render() {
  let html = '';
  let lastSec = null;
  items.forEach((it, i) => {
    if (it.sec !== lastSec) {
      html += `<div class="sec">${esc(it.sec)}</div>`;
      lastSec = it.sec;
    }
    html += `<div class="res${i === sel ? ' sel' : ''}${it.kind === 'calc' ? ' calc' : ''}" data-i="${i}">
      <div class="ri">${iconFor(it)}</div><div class="nm">${esc(it.name)}</div>${it.note ? `<div class="kind">${esc(it.note)}</div>` : ''}</div>`;
  });
  results.innerHTML = html;
  results.querySelectorAll('img').forEach((img) => (img.onerror = () => (img.outerHTML = Icons.app('generic', '?'))));
  resize();
}

function resize() {
  requestAnimationFrame(() => api.send('spotlight:resize', panel.getBoundingClientRect().height + 16 + 30));
}

function setSel(i) {
  if (!items.length) return;
  sel = (i + items.length) % items.length;
  results.querySelectorAll('.res').forEach((el) => el.classList.toggle('sel', +el.dataset.i === sel));
  const el = results.querySelector('.res.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}

function hide() {
  api.send('spotlight:hide');
}

function run(it) {
  if (!it) return;
  if (it.kind === 'app') api.send('apps:launch', it.id);
  else if (it.kind === 'cmd') api.invoke('act', it.act);
  else if (it.kind === 'calc') api.invoke('clipboard:write', it.raw);
  else if (it.kind === 'web' || it.kind === 'url') api.invoke('act', { type: 'uri', value: it.url });
  hide();
}

q.addEventListener('input', search);
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setSel(sel + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setSel(sel - 1);
  } else if (e.key === 'Enter') {
    run(items[sel]);
  } else if (e.key === 'Escape') {
    if (q.value) {
      q.value = '';
      search();
    } else hide();
  }
});
results.addEventListener('mousemove', (e) => {
  const el = e.target.closest('.res');
  if (el && +el.dataset.i !== sel) setSel(+el.dataset.i);
});
results.addEventListener('click', (e) => {
  const el = e.target.closest('.res');
  if (el) run(items[+el.dataset.i]);
});
results.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const el = e.target.closest('.res');
  const it = el && items[+el.dataset.i];
  if (it && it.kind === 'app') api.send('apps:menu', it.id);
});

let appsLoadedAt = 0;
async function loadApps() {
  apps = await api.invoke('apps:list');
  appsLoadedAt = Date.now();
  if (q.value) search();
}
api.on('apps:changed', loadApps);
api.on('spotlight:show', () => {
  if (Date.now() - appsLoadedAt > 60000) loadApps();
  q.focus();
  q.select();
  if (q.value) search();
  else resize();
});

api.on('settings', (st) => LiquidGlass.setEnabled(!!st.appearance.liquidGlass));
api.invoke('settings:get').then((st) => LiquidGlass.setEnabled(!!st.appearance.liquidGlass));
loadApps();
Glass.load();
resize();
