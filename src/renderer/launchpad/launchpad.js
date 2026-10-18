const q = document.getElementById('q');
const viewport = document.getElementById('viewport');
const pagesEl = document.getElementById('pages');
const dotsEl = document.getElementById('dots');
document.getElementById('gl').innerHTML = Icons.glyph('search');

let apps = [];
let page = 0;
let pageCount = 1;
let filtered = [];
let kbIndex = 0;
let closing = false;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function metrics() {
  const W = viewport.clientWidth;
  const H = viewport.clientHeight;
  const cols = W > 1500 ? 8 : 7;
  const icon = Math.round(Math.max(56, Math.min(104, H / 6.2, W / (cols * 1.9))));
  const cellW = Math.min(Math.floor((W * 0.86) / cols), icon * 2);
  const cellH = icon + 44;
  const rows = Math.max(2, Math.min(5, Math.floor(H / cellH)));
  return { cols, rows, icon, cellW, cellH };
}

function render() {
  const m = metrics();
  document.documentElement.style.setProperty('--icon', m.icon + 'px');
  document.documentElement.style.setProperty('--cell', m.cellW + 'px');
  const per = m.cols * m.rows;
  const query = q.value.trim().toLowerCase();
  filtered = query ? apps.filter((a) => a.name.toLowerCase().includes(query)) : apps.filter((a) => !a.admin);
  pageCount = query ? 1 : Math.max(1, Math.ceil(filtered.length / per));
  page = Math.min(page, pageCount - 1);
  let html = '';
  for (let p = 0; p < pageCount; p++) {
    const slice = query ? filtered.slice(0, per) : filtered.slice(p * per, (p + 1) * per);
    html += `<div class="page" style="left:${p * 100}%;grid-template-columns:repeat(${m.cols}, ${m.cellW}px);grid-auto-rows:${m.cellH}px">`;
    slice.forEach((a, i) => {
      const idx = query ? i : p * per + i;
      const ic = a.icon ? `<img src="${a.icon}" alt="">` : Icons.app('generic', a.name);
      html += `<div class="app" data-id="${esc(a.id)}" data-i="${idx}"><div class="ic">${ic}</div><div class="nm">${esc(a.name)}</div></div>`;
    });
    html += '</div>';
  }
  if (!filtered.length) html = '<div class="empty">No Results</div>';
  pagesEl.innerHTML = html;
  pagesEl.querySelectorAll('img').forEach((img) => (img.onerror = () => (img.outerHTML = Icons.app('generic', '?'))));
  dotsEl.innerHTML = pageCount > 1 ? [...Array(pageCount)].map((_, i) => `<i data-p="${i}"></i>`).join('') : '';
  kbIndex = 0;
  markKb();
  goTo(page, true);
}

function goTo(p, instant) {
  page = Math.max(0, Math.min(pageCount - 1, p));
  if (instant) pagesEl.style.transition = 'none';
  pagesEl.style.transform = `translateX(${-page * 100}%)`;
  if (instant) requestAnimationFrame(() => (pagesEl.style.transition = ''));
  dotsEl.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === page));
}

function markKb() {
  const query = q.value.trim();
  pagesEl.querySelectorAll('.app').forEach((el) => el.classList.toggle('kb', !!query && +el.dataset.i === kbIndex));
}

function open() {
  closing = false;
  q.value = '';
  page = 0;
  render();
  document.body.classList.remove('open');
  void document.body.offsetWidth;
  document.body.classList.add('open');
  setTimeout(() => q.focus(), 30);
}

function close() {
  if (closing) return;
  closing = true;
  document.body.classList.remove('open');
  setTimeout(() => api.send('launchpad:hidden'), 220);
}

function launch(id) {
  api.send('apps:launch', id);
  close();
}

pagesEl.addEventListener('click', (e) => {
  const el = e.target.closest('.app');
  if (el) launch(el.dataset.id);
  else close();
});
viewport.addEventListener('click', (e) => {
  if (e.target === viewport) close();
});
document.getElementById('root').addEventListener('click', (e) => {
  if (e.target.id === 'root') close();
});
dotsEl.addEventListener('click', (e) => {
  const d = e.target.closest('i');
  if (d) goTo(+d.dataset.p);
  else close();
});
pagesEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const el = e.target.closest('.app');
  if (el) api.send('apps:menu', el.dataset.id);
});

let wheelLock = 0;
window.addEventListener(
  'wheel',
  (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 8 || Date.now() < wheelLock) return;
    wheelLock = Date.now() + 450;
    goTo(page + (d > 0 ? 1 : -1));
  },
  { passive: true }
);

q.addEventListener('input', () => {
  page = 0;
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (q.value) {
      q.value = '';
      render();
    } else close();
  } else if (e.key === 'Enter') {
    if (q.value.trim() && filtered[kbIndex]) launch(filtered[kbIndex].id);
  } else if (!q.value && (e.key === 'ArrowRight' || e.key === 'PageDown')) {
    goTo(page + 1);
  } else if (!q.value && (e.key === 'ArrowLeft' || e.key === 'PageUp')) {
    goTo(page - 1);
  } else if (q.value && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const cols = metrics().cols;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    kbIndex = Math.max(0, Math.min(Math.min(filtered.length, metrics().cols * metrics().rows) - 1, kbIndex + step));
    markKb();
  }
});

window.addEventListener('resize', () => render());

async function loadApps() {
  apps = await api.invoke('apps:list');
  if (document.body.classList.contains('open')) render();
}
api.on('apps:changed', loadApps);
api.on('launchpad:show', open);
api.on('launchpad:close', close);

loadApps();
Glass.load();
