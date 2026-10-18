const wrap = document.getElementById('wrap');
const dockEl = document.getElementById('dock');
const itemsEl = document.getElementById('items');
const tip = document.getElementById('tip');
const bgEl = document.getElementById('bg');
const lgDock = LiquidGlass.attach(bgEl, { band: 16, scale: 38 });

// Keep the refracted wallpaper pinned in place while the Dock slides in and out.
let slideRaf = 0;
let slideUntil = 0;
function followSlide() {
  LiquidGlass.updateAll();
  slideRaf = Date.now() < slideUntil ? requestAnimationFrame(followSlide) : 0;
}
wrap.addEventListener('transitionrun', () => {
  slideUntil = Date.now() + 450;
  if (!slideRaf) slideRaf = requestAnimationFrame(followSlide);
});

const GAP = 2;
const PADX = 6;
const SEP_W = 13;
const BOTTOM_PAD = 7;

let state = { apps: [], trashFull: false };
let S = 52;
let M = 1.75;
let autohide = true;
let shown = true;
let inside = false;
let interactive = false;
let mouseX = null;
let amp = 0;
let maxSize = 52;
let menuOpen = false;
let dragging = null;
let justDragged = 0;
let hovered = null;
let order = [];
const els = new Map();

// ------------------------------------------------------------ rendering
function iconHtml(it) {
  if (it.svg) return Icons.app(it.svg, it.svg === 'trash' ? it.full : it.name);
  if (it.icon) return `<img src="${it.icon}" draggable="false" alt="">`;
  return Icons.app('generic', it.name);
}

function createEl(it) {
  if (it.sep) {
    const s = document.createElement('div');
    s.className = 'sep';
    return s;
  }
  const el = document.createElement('div');
  el.className = 'it';
  el.dataset.id = it.id;
  el.innerHTML = '<div class="ico"></div><div class="dot"></div>';
  return el;
}

function updateEl(el, it) {
  if (it.sep) return;
  const key = `${it.svg || ''}|${it.icon || ''}|${it.name}|${it.full ? 1 : 0}`;
  if (el._key !== key) {
    el._key = key;
    const ico = el.querySelector('.ico');
    ico.innerHTML = iconHtml(it);
    const img = ico.querySelector('img');
    if (img) img.onerror = () => (ico.innerHTML = Icons.app('generic', it.name));
  }
  el.dataset.name = it.name;
  el.dataset.pinned = it.pinned ? '1' : '';
  el.draggable = !!it.pinned;
  el.classList.toggle('running', !!it.running);
}

function render() {
  if (dragging) return;
  const list = [
    ...state.apps,
    { id: '__sep', sep: true },
    { id: 'downloads', name: 'Downloads', svg: 'downloads' },
    { id: 'trash', name: 'Trash', svg: 'trash', full: state.trashFull },
  ];
  const seen = new Set();
  const next = [];
  for (const it of list) {
    let el = els.get(it.id);
    if (!el) {
      el = createEl(it);
      els.set(it.id, el);
    }
    updateEl(el, it);
    seen.add(it.id);
    next.push(el);
  }
  for (const [id, el] of els) {
    if (!seen.has(id)) {
      el.remove();
      els.delete(id);
    }
  }
  next.forEach((el, i) => {
    if (itemsEl.children[i] !== el) itemsEl.insertBefore(el, itemsEl.children[i] || null);
  });
  order = next;
  relayout();
}

// ------------------------------------------------------------ magnification
function relayout() {
  let x = 0;
  const centers = [];
  for (const el of order) {
    const w = el.classList.contains('sep') ? SEP_W : S;
    centers.push(x + w / 2);
    x += w + GAP;
  }
  const totalBase = x - GAP + PADX * 2;
  const left0 = (window.innerWidth - totalBase) / 2 + PADX;
  const m = (M - 1) * amp;
  maxSize = S;
  order.forEach((el, i) => {
    if (el.classList.contains('sep')) return;
    let scale = 1;
    if (m > 0 && mouseX != null) {
      const d = Math.abs(mouseX - (left0 + centers[i])) / (S * 3.1);
      if (d < 1) scale = 1 + (m * (Math.cos(Math.PI * d) + 1)) / 2;
    }
    const sz = S * scale;
    if (sz > maxSize) maxSize = sz;
    const px = sz.toFixed(2) + 'px';
    if (el.style.width !== px) {
      el.style.width = px;
      el.style.height = px;
    }
  });
  placeTip();
}

let raf = 0;
function kick() {
  if (!raf) raf = requestAnimationFrame(loop);
}
function loop() {
  raf = 0;
  const target = inside && !dragging && !menuOpen ? 1 : 0;
  amp += (target - amp) * 0.28;
  if (Math.abs(target - amp) < 0.01) amp = target;
  relayout();
  if (amp !== target) kick();
}

// ------------------------------------------------------------ tooltip
function showTip(el) {
  hovered = el;
  if (!el || dragging || menuOpen) return hideTip();
  tip.textContent = el.dataset.name || '';
  tip.classList.add('show');
  placeTip();
}
function hideTip() {
  hovered = null;
  tip.classList.remove('show');
}
function placeTip() {
  if (!hovered || !tip.classList.contains('show')) return;
  const r = hovered.getBoundingClientRect();
  tip.style.left = r.left + r.width / 2 + 'px';
  tip.style.top = r.top - 36 + 'px';
}

// ------------------------------------------------------------ show / hide
let hideT = null;
let revealT = null;
function setInteractive(v) {
  if (v === interactive) return;
  if (!v && dragging) return;
  interactive = v;
  api.send('dock:ignore', !v);
}
function show() {
  clearTimeout(hideT);
  hideT = null;
  if (shown) return;
  shown = true;
  wrap.classList.remove('hidden');
}
function hide() {
  hideT = null;
  if (!autohide || inside || menuOpen || dragging) return;
  shown = false;
  wrap.classList.add('hidden');
  hideTip();
}
function scheduleHide(ms = 450) {
  clearTimeout(hideT);
  if (!autohide) return;
  hideT = setTimeout(hide, ms);
}

function pointer(x, y, target) {
  if (autohide && !shown) {
    if (y >= window.innerHeight - 4) {
      if (!revealT) revealT = setTimeout(() => ((revealT = null), show()), 90);
    } else {
      clearTimeout(revealT);
      revealT = null;
    }
  }
  const r = dockEl.getBoundingClientRect();
  const top = inside ? Math.min(r.top, r.bottom - BOTTOM_PAD - maxSize) : r.top;
  const over = shown && x >= r.left - 2 && x <= r.right + 2 && y >= top - 2 && y <= window.innerHeight;
  if (over !== inside) {
    inside = over;
    setInteractive(over);
    if (over) {
      clearTimeout(hideT);
      hideT = null;
    } else {
      scheduleHide();
      hideTip();
    }
  } else if (autohide && shown && !over) {
    // Up, but the pointer isn't on it (it may never have reached it, or has left the
    // window): stay while it rests on the bottom edge, otherwise slide back down.
    if (y >= window.innerHeight - 4) {
      clearTimeout(hideT);
      hideT = null;
    } else if (!hideT) scheduleHide(600);
  }
  if (over) {
    mouseX = x;
    const it = target && target.closest && target.closest('.it');
    if (it !== hovered) showTip(it);
    LiquidGlass.highlight(lgDock, x, y);
  } else {
    LiquidGlass.highlight(lgDock, null);
  }
  kick();
}
document.addEventListener('mousemove', (e) => pointer(e.clientX, e.clientY, e.target));
// while click-through, the main process reports the pointer instead
api.on('dock:pointer', (p) => {
  if (!interactive) pointer(p.x, p.y, document.elementFromPoint(p.x, p.y));
});

document.addEventListener('mouseleave', () => {
  if (dragging) return;
  inside = false;
  setInteractive(false);
  scheduleHide();
  hideTip();
  kick();
});

// ------------------------------------------------------------ clicks & menus
itemsEl.addEventListener('click', async (e) => {
  const el = e.target.closest('.it');
  if (!el || Date.now() - justDragged < 300) return;
  const res = await api.invoke('dock:click', el.dataset.id);
  if (res && res.launched) bounce(el);
});

function bounce(el) {
  el._bounceStart = Date.now();
  el.classList.add('bounce');
}
itemsEl.addEventListener('animationiteration', (e) => {
  const el = e.target.closest('.it');
  if (!el) return;
  const t = Date.now() - (el._bounceStart || 0);
  if ((el.classList.contains('running') && t > 1100) || t > 5500) el.classList.remove('bounce');
});

dockEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  hideTip();
  const el = e.target.closest('.it');
  if (el) api.send('dock:menu', el.dataset.id);
  else api.send('dock:bgmenu');
});

api.on('native-menu', (open) => {
  menuOpen = open;
  if (!open) {
    inside = false;
    setInteractive(false);
    scheduleHide(700);
  }
  kick();
});

// ------------------------------------------------------------ drag to reorder pinned items
itemsEl.addEventListener('dragstart', (e) => {
  const el = e.target.closest('.it');
  if (!el || el.dataset.pinned !== '1') return e.preventDefault();
  dragging = el;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', el.dataset.id);
  hideTip();
  kick();
});
itemsEl.addEventListener('dragover', (e) => {
  if (!dragging) return;
  e.preventDefault();
  const target = e.target.closest('.it');
  if (!target || target === dragging || target.dataset.pinned !== '1') return;
  const r = target.getBoundingClientRect();
  const after = e.clientX > r.left + r.width / 2;
  itemsEl.insertBefore(dragging, after ? target.nextSibling : target);
  order = [...itemsEl.children];
  relayout();
});
itemsEl.addEventListener('drop', (e) => e.preventDefault());
itemsEl.addEventListener('dragend', () => {
  if (!dragging) return;
  dragging.classList.remove('dragging');
  const ids = [...itemsEl.querySelectorAll('.it[data-pinned="1"]')].map((el) => el.dataset.id);
  dragging = null;
  justDragged = Date.now();
  order = [...itemsEl.children];
  api.send('dock:reorder', ids);
  kick();
});

// ------------------------------------------------------------ data
function applySettings(s) {
  S = s.dock.size;
  M = s.dock.magnify ? s.dock.magnifyScale : 1;
  autohide = s.dock.autohide;
  document.documentElement.style.setProperty('--S', S + 'px');
  LiquidGlass.setEnabled(!!(s.appearance && s.appearance.liquidGlass));
  if (!autohide) show();
  else if (!inside) scheduleHide(800);
  relayout();
}

api.on('settings', applySettings);
// The main process moved the dock to the display whose bottom edge you pushed against.
api.on('dock:reveal', () => {
  show();
  if (!inside) scheduleHide(1600);
});
api.on('dock:state', (s) => {
  state = s;
  render();
});

(async function init() {
  applySettings(await api.invoke('settings:get'));
  state = await api.invoke('dock:get');
  render();
  Glass.load();
  // Show briefly on launch so it's discoverable, then tuck away if auto-hide is on.
  shown = true;
  wrap.classList.remove('hidden');
  if (autohide) scheduleHide(1800);
})();
