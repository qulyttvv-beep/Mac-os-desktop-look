const panel = document.getElementById('panel');
const content = document.getElementById('pc');
const lgPanel = LiquidGlass.attach(panel, { band: 14, scale: 30, pointer: true, frost: 0.6 });
function setPanel(kind) {
  panel.className = `panel glass lg ${kind}`;
}
let token = 0;
let kind = null;
let appInfo = { name: 'Finder', finder: true };
let settings = null;
let userName = '';
let menuItems = [];
let hiIndex = -1;

const act = (a) => api.invoke('act', a);
const keys = (k) => ({ type: 'keys', keys: k });
const uri = (value) => ({ type: 'uri', value });
const explorer = (...args) => ({ type: 'launch', spec: { type: 'explorer', args } });

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------------------------------------------------------------- sizing
// Menus hang directly under the menu bar (small top margin); centered panels get room
// for their shadow on every side.
let panelTop = 3;
let sizeRaf = 0;
function reportSize() {
  cancelAnimationFrame(sizeRaf);
  sizeRaf = requestAnimationFrame(() => {
    const r = panel.getBoundingClientRect();
    api.send('popup:size', { w: r.width, h: r.height, token, top: panelTop });
  });
}
new ResizeObserver(reportSize).observe(panel);

// Clicking the transparent margin around the panel counts as clicking outside.
document.addEventListener('mousedown', (e) => {
  if (!panel.contains(e.target)) api.send('popup:close');
});

// ---------------------------------------------------------------- menus
function menuDefs(k) {
  const A = appInfo.name;
  const F = appInfo.finder;
  switch (k) {
    case 'logo':
      return [
        { label: 'About This PC', act: { type: 'open', what: 'about' } },
        '-',
        { label: 'Start Menu', act: { type: 'open', what: 'start' } },
        { label: 'System Settings…', act: uri('ms-settings:') },
        { label: 'App Store…', act: uri('ms-windows-store:') },
        { label: 'Desktop Settings…', act: { type: 'open', what: 'settings' } },
        { label: 'Wallpaper…', act: { type: 'open', what: 'wallpaper' } },
        '-',
        { label: 'Force Quit…', sc: 'Ctrl+Shift+Esc', act: { type: 'open', what: 'taskmgr' } },
        '-',
        { label: 'Sleep', act: { type: 'power', op: 'sleep' } },
        { label: 'Restart…', act: { type: 'power', op: 'restart' } },
        { label: 'Shut Down…', act: { type: 'power', op: 'shutdown' } },
        '-',
        { label: 'Lock Screen', sc: 'Win+L', act: { type: 'power', op: 'lock' } },
        { label: `Log Out ${userName}…`, act: { type: 'power', op: 'logout' } },
        '-',
        { label: 'Quit Mac Desktop', act: { type: 'quit' } },
      ];
    case 'app':
      return F
        ? [
            { label: 'Desktop Settings…', act: { type: 'open', what: 'settings' } },
            '-',
            { label: 'Empty Trash…', act: { type: 'emptyTrash' } },
            '-',
            { label: 'Hide Others', act: { type: 'app', op: 'hideOthers' } },
            { label: 'Show All', act: { type: 'app', op: 'showAll' } },
          ]
        : [
            { label: `Hide ${A}`, act: { type: 'app', op: 'hide' } },
            { label: 'Hide Others', act: { type: 'app', op: 'hideOthers' } },
            { label: 'Show All', act: { type: 'app', op: 'showAll' } },
            '-',
            { label: `Quit ${A}`, sc: 'Alt+F4', act: { type: 'app', op: 'quit' } },
          ];
    case 'menu:File':
      return F
        ? [
            { label: 'New Finder Window', sc: 'Ctrl+N', act: { type: 'launch', spec: { type: 'explorer' } } },
            { label: 'New Folder', sc: 'Ctrl+Shift+N', act: keys('ctrl+shift+n') },
            { label: 'New Tab', sc: 'Ctrl+T', act: keys('ctrl+t') },
            '-',
            { label: 'Open', sc: 'Enter', act: keys('enter') },
            { label: 'Rename', sc: 'F2', act: keys('f2') },
            { label: 'Get Info', sc: 'Alt+Enter', act: keys('alt+enter') },
            '-',
            { label: 'Move to Trash', sc: 'Delete', act: keys('delete') },
            '-',
            { label: 'Close Window', sc: 'Ctrl+W', act: keys('ctrl+w') },
          ]
        : [
            { label: 'New Window', sc: 'Ctrl+N', act: keys('ctrl+n') },
            { label: 'New Tab', sc: 'Ctrl+T', act: keys('ctrl+t') },
            { label: 'Open…', sc: 'Ctrl+O', act: keys('ctrl+o') },
            '-',
            { label: 'Save', sc: 'Ctrl+S', act: keys('ctrl+s') },
            { label: 'Save As…', sc: 'Ctrl+Shift+S', act: keys('ctrl+shift+s') },
            '-',
            { label: 'Print…', sc: 'Ctrl+P', act: keys('ctrl+p') },
            '-',
            { label: 'Close Tab', sc: 'Ctrl+W', act: keys('ctrl+w') },
            { label: 'Close Window', sc: 'Alt+F4', act: { type: 'winop', op: 'close' } },
          ];
    case 'menu:Edit':
      return [
        { label: 'Undo', sc: 'Ctrl+Z', act: keys('ctrl+z') },
        { label: 'Redo', sc: 'Ctrl+Y', act: keys('ctrl+y') },
        '-',
        { label: 'Cut', sc: 'Ctrl+X', act: keys('ctrl+x') },
        { label: 'Copy', sc: 'Ctrl+C', act: keys('ctrl+c') },
        { label: 'Paste', sc: 'Ctrl+V', act: keys('ctrl+v') },
        { label: 'Select All', sc: 'Ctrl+A', act: keys('ctrl+a') },
        '-',
        { label: 'Find…', sc: 'Ctrl+F', act: keys('ctrl+f') },
        '-',
        { label: 'Emoji & Symbols', sc: 'Win+.', act: keys('win+period') },
      ];
    case 'menu:View':
      return F
        ? [
            { label: 'as Icons', sc: 'Ctrl+Shift+2', act: keys('ctrl+shift+2') },
            { label: 'as List', sc: 'Ctrl+Shift+5', act: keys('ctrl+shift+5') },
            { label: 'as Details', sc: 'Ctrl+Shift+6', act: keys('ctrl+shift+6') },
            { label: 'as Tiles', sc: 'Ctrl+Shift+7', act: keys('ctrl+shift+7') },
            '-',
            { label: 'Show Preview Pane', sc: 'Alt+P', act: keys('alt+p') },
            { label: 'Show Details Pane', sc: 'Alt+Shift+P', act: keys('alt+shift+p') },
            '-',
            { label: 'Refresh', sc: 'F5', act: keys('f5') },
          ]
        : [
            { label: 'Zoom In', sc: 'Ctrl +', act: keys('ctrl+plus') },
            { label: 'Zoom Out', sc: 'Ctrl −', act: keys('ctrl+minus') },
            { label: 'Actual Size', sc: 'Ctrl+0', act: keys('ctrl+0') },
            '-',
            { label: 'Reload', sc: 'F5', act: keys('f5') },
            '-',
            { label: 'Enter Full Screen', sc: 'F11', act: keys('f11') },
          ];
    case 'menu:Go':
      return [
        { label: 'Back', sc: 'Alt+←', act: keys('alt+left') },
        { label: 'Forward', sc: 'Alt+→', act: keys('alt+right') },
        { label: 'Enclosing Folder', sc: 'Alt+↑', act: keys('alt+up') },
        '-',
        { label: 'Home', act: { type: 'folder', which: 'home' } },
        { label: 'Desktop', act: { type: 'folder', which: 'desktop' } },
        { label: 'Documents', act: { type: 'folder', which: 'documents' } },
        { label: 'Downloads', act: { type: 'folder', which: 'downloads' } },
        { label: 'Pictures', act: { type: 'folder', which: 'pictures' } },
        { label: 'Music', act: { type: 'folder', which: 'music' } },
        { label: 'Videos', act: { type: 'folder', which: 'videos' } },
        '-',
        { label: 'Applications', act: { type: 'open', what: 'launchpad' } },
        { label: 'Computer', act: explorer('shell:MyComputerFolder') },
        { label: 'Network', act: explorer('shell:NetworkPlacesFolder') },
        { label: 'Trash', act: explorer('shell:RecycleBinFolder') },
      ];
    case 'menu:Window':
      return [
        { label: 'Minimize', sc: 'Win+↓', act: { type: 'winop', op: 'minimize' } },
        { label: 'Zoom', act: { type: 'winop', op: 'zoom' } },
        '-',
        { label: 'Tile Window to Left of Screen', sc: 'Win+←', act: keys('win+left') },
        { label: 'Tile Window to Right of Screen', sc: 'Win+→', act: keys('win+right') },
        { label: 'Snap Layouts…', sc: 'Win+Z', act: keys('win+z') },
        '-',
        { label: 'Mission Control', sc: 'Win+Tab', act: keys('win+tab') },
        { label: 'Show Desktop', sc: 'Win+D', act: keys('win+d') },
        '-',
        { label: 'Close Window', act: { type: 'winop', op: 'close' } },
      ];
    case 'menu:Help':
      return [
        { label: `${A} Help`, act: uri(`https://www.google.com/search?q=${encodeURIComponent(A + ' help')}`) },
        { label: 'Windows Keyboard Shortcuts', act: uri('https://www.google.com/search?q=windows+11+keyboard+shortcuts') },
        '-',
        { label: 'Mac Desktop Settings…', act: { type: 'open', what: 'settings' } },
      ];
  }
  return [];
}

function renderMenu(defs) {
  setPanel('menu');
  menuItems = [];
  hiIndex = -1;
  content.innerHTML = '';
  for (const d of defs) {
    if (d === '-') {
      content.appendChild(h('<div class="sep"></div>'));
      continue;
    }
    if (d.html) {
      content.appendChild(h(d.html));
      continue;
    }
    const row = h(
      `<div class="mi${d.disabled ? ' disabled' : ''}"><span class="label">${esc(d.label)}</span>${
        d.sc ? `<span class="sc">${esc(d.sc)}</span>` : ''
      }</div>`
    );
    const idx = menuItems.length;
    menuItems.push({ el: row, def: d });
    row.addEventListener('mouseenter', () => setHi(idx));
    row.addEventListener('mouseleave', () => setHi(-1));
    row.addEventListener('mouseup', () => runItem(d));
    content.appendChild(row);
  }
}

function setHi(i) {
  hiIndex = i;
  menuItems.forEach((m, j) => m.el.classList.toggle('hi', j === i));
}

function runItem(d) {
  if (!d || d.disabled) return;
  if (d.fn) return d.fn();
  if (d.act) act(d.act);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return api.send('popup:close');
  if (!menuItems.length || !panel.classList.contains('menu')) return;
  const n = menuItems.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    let i = hiIndex;
    for (let k = 0; k < n; k++) {
      i = e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n;
      if (!menuItems[i].def.disabled) break;
    }
    setHi(i);
  } else if (e.key === 'Enter' && hiIndex >= 0) {
    runItem(menuItems[hiIndex].def);
  }
});

// ---------------------------------------------------------------- shared widgets
function toggle(on, onChange) {
  const t = h(`<div class="sw${on ? ' on' : ''}"><i></i></div>`);
  t.addEventListener('click', () => {
    const v = !t.classList.contains('on');
    t.classList.toggle('on', v);
    onChange(v);
  });
  return t;
}

function slider(value, glyph, onInput, onGlyph) {
  const s = h(`<div class="slider"><div class="fill"></div><div class="knob"></div><div class="gl">${glyph}</div></div>`);
  const fill = s.querySelector('.fill');
  const knob = s.querySelector('.knob');
  const set = (v) => {
    value = Math.max(0, Math.min(1, v));
    const px = 22 + value * (s.clientWidth - 22 || 200);
    fill.style.width = px + 'px';
    knob.style.left = px + 'px';
  };
  requestAnimationFrame(() => set(value));
  const fromEvent = (e) => {
    const r = s.getBoundingClientRect();
    return (e.clientX - r.left - 11) / (r.width - 22);
  };
  s.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.gl') && onGlyph) return onGlyph();
    s.setPointerCapture(e.pointerId);
    set(fromEvent(e));
    onInput(value);
    const move = (ev) => {
      set(fromEvent(ev));
      onInput(value);
    };
    const up = () => {
      s.removeEventListener('pointermove', move);
      s.removeEventListener('pointerup', up);
    };
    s.addEventListener('pointermove', move);
    s.addEventListener('pointerup', up);
  });
  s.setValue = set;
  return s;
}

function throttle(fn, ms) {
  let last = 0;
  let t = null;
  let pending;
  return (...a) => {
    pending = a;
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...pending);
    } else {
      clearTimeout(t);
      t = setTimeout(() => {
        last = Date.now();
        fn(...pending);
      }, ms - (now - last));
    }
  };
}

// ---------------------------------------------------------------- control center
async function buildControl(my) {
  setPanel('cc');
  const grid = h('<div class="cc-grid"></div>');
  grid.style.maxHeight = Math.max(320, screen.availHeight - 90) + 'px';
  content.innerHTML = '';
  content.appendChild(grid);
  const s = settings || (await api.invoke('settings:get'));
  const linkTo = (el, value) => el.addEventListener('click', () => act(uri(value)));

  // ---------------------------------------------------------------- connectivity + toggles
  const net = h(`<div class="mod">
      <div class="row"><div class="circ on clickable" id="netc">${Icons.glyph('wifi')}</div><div class="txt clickable" id="nettx"><div class="t" id="nett">Wi-Fi</div><div class="s" id="nets">…</div></div></div>
      <div class="row"><div class="circ clickable" id="btc">${Icons.glyph('bluetooth')}</div><div class="txt clickable" id="bttx"><div class="t">Bluetooth</div><div class="s" id="bts">…</div></div></div>
      <div class="row"><div class="circ clickable" id="air">${planeGlyph}</div><div class="txt clickable" id="airtx"><div class="t">Airplane</div><div class="s">Mode</div></div></div>
    </div>`);
  grid.appendChild(net);
  linkTo(net.querySelector('#nettx'), 'ms-settings:network');
  linkTo(net.querySelector('#netc'), 'ms-settings:network');
  linkTo(net.querySelector('#bttx'), 'ms-settings:bluetooth');
  linkTo(net.querySelector('#air'), 'ms-settings:network-airplanemode');
  linkTo(net.querySelector('#airtx'), 'ms-settings:network-airplanemode');

  const right = h(`<div class="mod split">
      <div class="mod clickable" id="dark"><div class="circ">${Icons.glyph('moon')}</div><div class="tl">Dark Mode</div></div>
      <div class="mod clickable" id="dispset"><div class="circ">${screenGlyph}</div><div class="tl">Display</div></div>
    </div>`);
  grid.appendChild(right);
  linkTo(right.querySelector('#dispset'), 'ms-settings:display');

  // ---------------------------------------------------------------- display brightness (DDC/CI monitors)
  const disp = h(`<div class="mod full" hidden><div class="title">Display</div></div>`);
  grid.appendChild(disp);

  // ---------------------------------------------------------------- sound: output, devices, per-app mixer
  const snd = h(`<div class="mod full">
      <div class="title row-head"><span>Sound</span><span class="sub" id="outname"></span><span class="chev clickable" id="sndx">${Icons.glyph('chevR')}</span></div>
      <div id="sndsl"></div>
      <div class="expand" id="sndmore" hidden>
        <div class="minihead">Output</div><div id="outs"></div>
        <div class="minihead">Apps</div><div id="mixer"><div class="dim">No apps are playing sound</div></div>
        <div class="link clickable" id="sndset">Sound Settings…</div>
      </div>
    </div>`);
  grid.appendChild(snd);
  linkTo(snd.querySelector('#sndset'), 'ms-settings:sound');
  snd.querySelector('#sndx').addEventListener('click', () => {
    const more = snd.querySelector('#sndmore');
    more.hidden = !more.hidden;
    snd.querySelector('#sndx').classList.toggle('open', !more.hidden);
    if (!more.hidden) loadMixer();
  });

  // ---------------------------------------------------------------- microphone (only when there is one)
  const mic = h(`<div class="mod full" hidden>
      <div class="title row-head"><span>Microphone</span><span class="sub" id="inname"></span><span class="chev clickable" id="micx">${Icons.glyph('chevR')}</span></div>
      <div id="micsl"></div>
      <div class="expand" id="micmore" hidden><div class="minihead">Input</div><div id="ins"></div></div>
    </div>`);
  grid.appendChild(mic);
  mic.querySelector('#micx').addEventListener('click', () => {
    const more = mic.querySelector('#micmore');
    more.hidden = !more.hidden;
    mic.querySelector('#micx').classList.toggle('open', !more.hidden);
  });

  // ---------------------------------------------------------------- now playing
  const media = h(`<div class="mod full np">
      <div class="np-art" id="art"></div>
      <div class="np-txt"><div class="np-title" id="mt">Not Playing</div><div class="np-sub" id="ma"></div></div>
      <div class="media">
        <div class="btn" data-k="prev">${Icons.glyph('prev')}</div>
        <div class="btn" data-k="toggle" id="pp">${Icons.glyph('playpause')}</div>
        <div class="btn" data-k="next">${Icons.glyph('next')}</div>
      </div>
    </div>`);
  media.querySelectorAll('.btn').forEach((b) =>
    b.addEventListener('click', async () => {
      await api.invoke('sys:media:cmd', b.dataset.k);
      setTimeout(loadMedia, 350);
    })
  );
  grid.appendChild(media);

  // ---------------------------------------------------------------- desktop tiles
  const tiles = h(`<div class="mod full"><div class="tiles4">
      <div class="tilebtn clickable" data-t="dock"><div class="circ${s.dock.autohide ? ' on' : ''}">${Icons.glyph('dock')}</div>Hide Dock</div>
      <div class="tilebtn clickable" data-t="taskbar"><div class="circ${s.hideTaskbar ? ' on' : ''}">${Icons.glyph('taskbar')}</div>Hide Taskbar</div>
      <div class="tilebtn clickable" data-t="widgets"><div class="circ${anyWidget(s) ? ' on' : ''}">${widgetsGlyph}</div>Widgets</div>
      <div class="tilebtn clickable" data-t="wall"><div class="circ${s.wallpaper.on ? ' on' : ''}">${wallGlyph}</div>Live Wall</div>
    </div><div class="links"><span class="link clickable" id="wp">Wallpaper…</span><span class="link clickable" id="more">Desktop Settings…</span></div></div>`);
  const flip = (sel, fn) =>
    tiles.querySelector(sel).addEventListener('click', (e) => {
      const c = e.currentTarget.querySelector('.circ');
      const v = !c.classList.contains('on');
      c.classList.toggle('on', v);
      fn(v);
    });
  flip('[data-t="dock"]', (v) => api.invoke('settings:set', 'dock.autohide', v));
  flip('[data-t="taskbar"]', (v) => api.invoke('settings:set', 'hideTaskbar', v));
  flip('[data-t="wall"]', (v) => api.invoke('settings:set', 'wallpaper.on', v));
  flip('[data-t="widgets"]', (v) => {
    for (const [k, w] of Object.entries(s.widgets)) if (w && typeof w === 'object') api.invoke('settings:set', `widgets.${k}.on`, v);
  });
  tiles.querySelector('#more').addEventListener('click', () => act({ type: 'open', what: 'settings' }));
  tiles.querySelector('#wp').addEventListener('click', () => act({ type: 'open', what: 'wallpaper' }));
  grid.appendChild(tiles);
  reportSize();

  // ================================================================ async fill-ins
  const alive = () => my === token;

  api.invoke('sys:wifi').then((w) => {
    if (!alive()) return;
    const t = net.querySelector('#nett');
    const sEl = net.querySelector('#nets');
    const c = net.querySelector('#netc');
    if (w.hasWifi) {
      sEl.textContent = w.connected ? w.ssid || 'Connected' : 'Not Connected';
      c.classList.toggle('on', w.connected);
      c.innerHTML = Icons.glyph(w.connected ? 'wifi' : 'wifiOff');
    } else {
      t.textContent = 'Network';
      sEl.textContent = navigator.onLine ? 'Ethernet' : 'Offline';
      c.innerHTML = Icons.glyph('ethernet');
      c.classList.toggle('on', navigator.onLine);
    }
  });

  api.invoke('sys:radios').then((radios) => {
    if (!alive()) return;
    const bt = (radios || []).find((r) => r.kind === 'Bluetooth');
    const c = net.querySelector('#btc');
    const sEl = net.querySelector('#bts');
    if (!bt) {
      sEl.textContent = 'Not available';
      return;
    }
    let on = bt.on;
    const paint = () => {
      c.classList.toggle('on', on);
      sEl.textContent = on ? 'On' : 'Off';
    };
    paint();
    c.addEventListener('click', async () => {
      on = !on;
      paint();
      await api.invoke('sys:radio:set', { kind: 'Bluetooth', on });
    });
  });

  api.invoke('sys:theme').then((th) => {
    if (!alive() || !th) return;
    const tile = right.querySelector('#dark');
    let dark = !!th.dark;
    const paint = () => tile.querySelector('.circ').classList.toggle('on', dark);
    paint();
    tile.addEventListener('click', () => {
      dark = !dark;
      paint();
      api.invoke('sys:theme:set', dark);
    });
  });

  api.invoke('sys:monitors').then((mons) => {
    if (!alive() || !mons || !mons.length) return;
    disp.hidden = false;
    for (const m of mons) {
      const set = throttle((x) => api.invoke('sys:monitor:set', { index: m.index, value: Math.round(m.min + x * (m.max - m.min)) }), 160);
      if (mons.length > 1) disp.appendChild(h(`<div class="minilabel">${esc(m.label)}</div>`));
      disp.appendChild(slider(m.value, Icons.glyph('sun'), set));
    }
    reportSize();
  });

  // output volume + devices
  let muted = false;
  api.invoke('sys:volume').then((v) => {
    if (!alive()) return;
    if (!v) {
      snd.querySelector('#sndsl').appendChild(h('<div class="dim">Volume unavailable</div>'));
      return;
    }
    muted = v.muted;
    const setVol = throttle((x) => api.invoke('sys:volume:set', x), 50);
    const sl = slider(
      v.level,
      Icons.glyph(muted ? 'speakerMute' : 'speaker'),
      (x) => {
        setVol(x);
        if (muted) {
          muted = false;
          api.invoke('sys:mute:set', false);
          sl.querySelector('.gl').innerHTML = Icons.glyph('speaker');
        }
      },
      () => {
        muted = !muted;
        api.invoke('sys:mute:set', muted);
        sl.querySelector('.gl').innerHTML = Icons.glyph(muted ? 'speakerMute' : 'speaker');
      }
    );
    snd.querySelector('#sndsl').appendChild(sl);
    reportSize();
  });

  const deviceList = (wrap, list, onPick) => {
    wrap.innerHTML = '';
    for (const d of list) {
      const row = h(`<div class="devrow clickable${d.isDefault ? ' on' : ''}"><span class="check">${d.isDefault ? '✓' : ''}</span><span class="dn">${esc(d.name)}</span></div>`);
      row.addEventListener('click', async () => {
        await onPick(d);
        loadDevices();
      });
      wrap.appendChild(row);
    }
  };

  async function loadDevices() {
    const dev = await api.invoke('sys:audio:devices');
    if (!alive()) return;
    const out = dev.outputs.find((d) => d.isDefault);
    snd.querySelector('#outname').textContent = out ? out.name.replace(/\s*\(.*\)$/, '') : '';
    deviceList(snd.querySelector('#outs'), dev.outputs, (d) => api.invoke('sys:audio:default', d.id));
    if (dev.inputs.length) {
      mic.hidden = false;
      const inn = dev.inputs.find((d) => d.isDefault);
      mic.querySelector('#inname').textContent = inn ? inn.name.replace(/\s*\(.*\)$/, '') : '';
      deviceList(mic.querySelector('#ins'), dev.inputs, (d) => api.invoke('sys:audio:default', d.id));
      if (!mic.querySelector('.slider')) {
        const m = await api.invoke('sys:mic');
        if (m && alive()) {
          let mMuted = m.muted;
          const setMic = throttle((x) => api.invoke('sys:mic:set', { level: x }), 60);
          const ms = slider(m.level, Icons.glyph(mMuted ? 'micOff' : 'mic'), setMic, () => {
            mMuted = !mMuted;
            api.invoke('sys:mic:set', { muted: mMuted });
            ms.querySelector('.gl').innerHTML = Icons.glyph(mMuted ? 'micOff' : 'mic');
          });
          mic.querySelector('#micsl').appendChild(ms);
        }
      }
    }
    reportSize();
  }
  loadDevices();

  async function loadMixer() {
    const list = await api.invoke('sys:mixer');
    if (!alive()) return;
    const box = snd.querySelector('#mixer');
    box.innerHTML = '';
    if (!list.length) {
      box.appendChild(h('<div class="dim">No apps are playing sound</div>'));
      return reportSize();
    }
    for (const a of list) {
      const icon = a.icon ? `<img src="${a.icon}" alt="">` : Icons.app(a.system ? 'settings' : 'generic', a.name);
      const row = h(`<div class="mixrow"><div class="mi-ic">${icon}</div><div class="mi-main"><div class="mi-name">${esc(a.name)}</div></div></div>`);
      let am = a.muted;
      const setApp = throttle((x) => api.invoke('sys:mixer:set', { pid: a.pid, level: x }), 60);
      const sl = slider(a.level, Icons.glyph(am ? 'speakerMute' : 'speaker'), setApp, () => {
        am = !am;
        api.invoke('sys:mixer:set', { pid: a.pid, muted: am });
        sl.querySelector('.gl').innerHTML = Icons.glyph(am ? 'speakerMute' : 'speaker');
      });
      sl.classList.add('small');
      row.querySelector('.mi-main').appendChild(sl);
      box.appendChild(row);
    }
    reportSize();
  }

  async function loadMedia() {
    const m = await api.invoke('sys:media');
    if (!alive()) return;
    const art = media.querySelector('#art');
    if (!m) {
      media.querySelector('#mt').textContent = 'Not Playing';
      media.querySelector('#ma').textContent = '';
      art.innerHTML = Icons.glyph('music') || '';
      art.classList.remove('has');
      return reportSize();
    }
    media.querySelector('#mt').textContent = m.title || 'Unknown';
    media.querySelector('#ma').textContent = [m.artist, m.app].filter(Boolean).join(' — ');
    art.innerHTML = m.art ? `<img src="${m.art}" alt="">` : '';
    art.classList.toggle('has', !!m.art);
    media.querySelector('#pp').innerHTML = Icons.glyph(m.playing ? 'pause' : 'play');
    reportSize();
  }
  loadMedia();
  const mediaTimer = setInterval(() => (alive() ? loadMedia() : clearInterval(mediaTimer)), 3000);
}

const planeGlyph =
  '<svg viewBox="0 0 16 16"><path d="M14.5 9.3V8L9 5V1.8a1 1 0 0 0-2 0V5L1.5 8v1.3L7 7.7v3.6L5.5 12.5v1.1L8 12.9l2.5.7v-1.1L9 11.3V7.7z" fill="currentColor"/></svg>';
const screenGlyph =
  '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 14h5M8 11v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const wallGlyph =
  '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.4" fill="currentColor"/><path d="M3.5 8a4.5 1.6 0 0 0 9 0" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
const widgetsGlyph =
  '<svg viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.4" fill="currentColor"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="1.5" y="9" width="13" height="5.5" rx="1.4" fill="currentColor"/></svg>';

function anyWidget(s) {
  return Object.values(s.widgets).some((w) => w.on);
}

// ---------------------------------------------------------------- settings
async function buildSettings() {
  setPanel('settings');
  const s = await api.invoke('settings:get');
  settings = s;
  const shortcut = await api.invoke('sys:shortcut');
  const maxH = Math.max(300, screen.availHeight - 120);
  const wrap = h(`<div class="settings-wrap" style="max-height:${maxH}px"></div>`);
  content.innerHTML = '';
  content.appendChild(wrap);

  const set = (p, v) => api.invoke('settings:set', p, v);
  wrap.appendChild(h(`<div class="s-title">Desktop Settings</div>`));

  const group = (title) => {
    wrap.appendChild(h(`<div class="s-head">${esc(title)}</div>`));
    const g = h('<div class="group"></div>');
    wrap.appendChild(g);
    return g;
  };
  const row = (g, label, control, hint) => {
    const r = h(`<div class="srow"><div class="lab"><span>${esc(label)}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div></div>`);
    r.appendChild(control);
    g.appendChild(r);
    return r;
  };
  const sw = (p, val) => toggle(!!val, (v) => set(p, v));
  const range = (p, val, min, max, step) => {
    const r = h(`<input class="range" type="range" min="${min}" max="${max}" step="${step}" value="${val}">`);
    r.addEventListener('change', () => set(p, parseFloat(r.value)));
    return r;
  };

  let g = group('Appearance');
  row(g, 'Liquid Glass', sw('appearance.liquidGlass', s.appearance.liquidGlass), 'Refractive glass for the Dock, menus, Spotlight and widgets');

  g = group('Wallpaper');
  row(g, 'Live wallpaper', sw('wallpaper.on', s.wallpaper.on), 'Animated, reactive scenes behind the desktop icons');
  row(g, 'Span Obsidian across displays', sw('wallpaper.span', s.wallpaper.span), 'Gummy Bears, Flux and Warp always span all monitors');
  const choose = h('<button class="pbtn">Choose…</button>');
  choose.addEventListener('click', () => act({ type: 'open', what: 'wallpaper' }));
  row(g, 'Scene', choose);

  g = group('Dock');
  row(g, 'Size', range('dock.size', s.dock.size, 32, 84, 1));
  row(g, 'Magnification', sw('dock.magnify', s.dock.magnify));
  row(g, 'Magnification amount', range('dock.magnifyScale', s.dock.magnifyScale, 1.2, 2.4, 0.05));
  row(g, 'Automatically hide and show the Dock', sw('dock.autohide', s.dock.autohide), 'When hiding, the Dock follows you to any display. When shown, windows stop above it');

  g = group('Menu Bar');
  row(g, 'Keep windows below the menu bar', sw('menubar.reserve', s.menubar.reserve), 'Maximized windows will not cover it');
  row(g, 'Show the menu bar on all displays', sw('menubar.allDisplays', s.menubar.allDisplays !== false));
  row(g, 'Show date', sw('menubar.showDate', s.menubar.showDate));
  row(g, 'Use a 24-hour clock', sw('menubar.clock24', s.menubar.clock24));
  row(g, 'Display the time with seconds', sw('menubar.seconds', s.menubar.seconds));
  row(g, 'Show battery percentage', sw('menubar.showBattery', s.menubar.showBattery));

  g = group('Windows');
  row(g, 'Hide the Windows taskbar', sw('hideTaskbar', s.hideTaskbar), 'Restored automatically when you quit');
  row(g, 'Windows key opens the Start menu', sw('startMenu.winKey', !s.startMenu || s.startMenu.winKey !== false), 'Search, pinned apps, all apps, power — Win+shortcuts keep working');
  row(g, 'Show recent files in Start', sw('startMenu.recent', !s.startMenu || s.startMenu.recent !== false));
  row(g, 'Open Mac Desktop at login', sw('openAtLogin', s.openAtLogin));
  row(g, 'Spotlight shortcut', h(`<kbd>${esc((shortcut || 'none').replace('Control', 'Ctrl'))}</kbd>`));

  g = group('Widgets');
  const names = { clock: 'Clock', weather: 'Weather', calendar: 'Calendar', system: 'System Monitor', notes: 'Sticky Note' };
  for (const k of Object.keys(names)) row(g, names[k], sw(`widgets.${k}.on`, s.widgets[k].on));
  const style = h(`<select class="sel"><option value="glass">Liquid Glass</option><option value="classic">Classic</option></select>`);
  style.value = s.appearance.widgetStyle;
  style.addEventListener('change', () => set('appearance.widgetStyle', style.value));
  row(g, 'Widget style', style);
  row(g, 'Snap to grid', sw('appearance.snapWidgets', s.appearance.snapWidgets), 'Widgets click into place and never overlap');
  const arrange = h('<button class="pbtn">Arrange</button>');
  arrange.addEventListener('click', () => api.send('widgets:arrange'));
  row(g, 'Tidy up all widgets', arrange);
  const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '').split('/').pop().replace(/_/g, ' ');
  const city = h(`<input class="txtin" placeholder="${esc(tz || 'e.g. London')} (auto)" value="${esc(s.widgets.weather.city)}">`);
  city.addEventListener('change', () => set('widgets.weather.city', city.value.trim()));
  city.addEventListener('keydown', (e) => e.key === 'Enter' && city.blur());
  row(g, 'Weather location', city);
  const units = h(`<select class="sel">
      <option value="auto">Automatic</option><option value="c">Celsius (°C)</option><option value="f">Fahrenheit (°F)</option></select>`);
  units.value = s.widgets.weather.units;
  units.addEventListener('change', () => set('widgets.weather.units', units.value));
  row(g, 'Temperature units', units);

  const btns = h(`<div class="btn-row"><button class="pbtn" id="q">Quit Mac Desktop</button><button class="pbtn primary" id="d">Done</button></div>`);
  btns.querySelector('#q').addEventListener('click', () => act({ type: 'quit' }));
  btns.querySelector('#d').addEventListener('click', () => api.send('popup:close'));
  wrap.appendChild(btns);
  reportSize();
}

// ---------------------------------------------------------------- calendar
function buildClock() {
  setPanel('clock');
  const now = new Date();
  let view = new Date(now.getFullYear(), now.getMonth(), 1);
  const wrap = h('<div class="cal"></div>');
  content.innerHTML = '';
  content.appendChild(wrap);

  const draw = () => {
    const today = new Date();
    const first = new Date(view);
    const startDow = first.getDay();
    const daysIn = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const prevDays = new Date(view.getFullYear(), view.getMonth(), 0).getDate();
    const dows = [...Array(7)].map((_, i) =>
      new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'narrow' })
    );
    let cells = dows.map((d) => `<div class="dow">${d}</div>`).join('');
    const total = Math.ceil((startDow + daysIn) / 7) * 7;
    for (let i = 0; i < total; i++) {
      const day = i - startDow + 1;
      let n = day;
      let cls = 'd';
      if (day < 1) {
        n = prevDays + day;
        cls += ' other';
      } else if (day > daysIn) {
        n = day - daysIn;
        cls += ' other';
      } else {
        const dow = i % 7;
        if (dow === 0 || dow === 6) cls += ' we';
        if (
          day === today.getDate() &&
          view.getMonth() === today.getMonth() &&
          view.getFullYear() === today.getFullYear()
        )
          cls += ' today';
      }
      cells += `<div class="${cls}"><span>${n}</span></div>`;
    }
    wrap.innerHTML = `
      <div class="cal-top">
        <div class="wd">${esc(today.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase())}</div>
        <div class="full">${esc(today.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }))}</div>
        <div class="time">${esc(today.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))} · ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' '))}</div>
      </div>
      <div class="cal-nav"><b>${esc(view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</b>
        <div class="navs"><div class="nb" data-d="-1">${Icons.glyph('chevL')}</div><div class="nb" data-d="0" title="Today">●</div><div class="nb" data-d="1">${Icons.glyph('chevR')}</div></div></div>
      <div class="cal-grid">${cells}</div>
      <div class="sep"></div>
      <div class="mi" id="dt"><span class="label">Date &amp; Time Settings…</span></div>`;
    wrap.querySelectorAll('.nb').forEach((b) =>
      b.addEventListener('click', () => {
        const d = parseInt(b.dataset.d, 10);
        view = d === 0 ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(view.getFullYear(), view.getMonth() + d, 1);
        draw();
      })
    );
    const dt = wrap.querySelector('#dt');
    dt.addEventListener('mouseenter', () => dt.classList.add('hi'));
    dt.addEventListener('mouseleave', () => dt.classList.remove('hi'));
    dt.addEventListener('click', () => act(uri('ms-settings:dateandtime')));
    reportSize();
  };
  draw();
}

// ---------------------------------------------------------------- small status menus
async function buildWifi(my) {
  const w = await api.invoke('sys:wifi');
  if (my !== token) return;
  const defs = [];
  if (w.hasWifi) {
    defs.push({ html: `<div class="mhead"><b>Wi-Fi</b><span>${w.connected ? 'On' : 'Not Connected'}</span></div>` });
    if (w.connected) {
      defs.push({
        html: `<div class="netrow"><div class="circ on">${Icons.glyph('wifi')}</div><div><div style="font-weight:600">${esc(w.ssid || 'Connected')}</div><div class="minfo" style="padding:0">${w.signal != null ? `Signal ${w.signal}%` : 'Connected'}</div></div></div>`,
      });
    }
    defs.push('-', { label: 'Wi-Fi Settings…', act: uri('ms-settings:network-wifi') });
  } else {
    defs.push({ html: `<div class="mhead"><b>Network</b><span>${navigator.onLine ? 'Connected' : 'Offline'}</span></div>` });
    defs.push({
      html: `<div class="netrow"><div class="circ ${navigator.onLine ? 'on' : ''}">${Icons.glyph('ethernet')}</div><div style="font-weight:600">Ethernet</div></div>`,
    });
    defs.push('-');
  }
  defs.push({ label: 'Network Settings…', act: uri('ms-settings:network') });
  renderMenu(defs);
  reportSize();
}

async function buildBattery(my) {
  const p = await api.invoke('sys:power');
  if (my !== token) return;
  if (!p || !p.hasBattery) return renderMenu([{ label: 'No battery', disabled: true }]);
  renderMenu([
    { html: `<div class="mhead"><b>Battery</b><span>${p.percent}%</span></div>` },
    { html: `<div class="minfo">Power Source: ${p.plugged ? 'Power Adapter' : 'Battery'}${p.charging ? ' (charging)' : ''}</div>` },
    { html: `<div class="minfo">Battery Saver: ${p.saver ? 'On' : 'Off'}</div>` },
    '-',
    { label: 'Battery Settings…', act: uri('ms-settings:batterysaver') },
  ]);
}

// ---------------------------------------------------------------- about
async function buildAbout(my) {
  const a = await api.invoke('sys:about');
  if (my !== token) return;
  setPanel('about');
  content.innerHTML = `<div class="about-wrap">
    <div class="traffic"><i id="close"></i><i></i><i></i></div>
    <svg class="art" viewBox="0 0 140 96"><defs><linearGradient id="scr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a7bd5"/><stop offset=".5" stop-color="#8e54e9"/><stop offset="1" stop-color="#ff6a88"/></linearGradient></defs>
      <rect x="8" y="2" width="124" height="76" rx="6" fill="#1d1d1f"/><rect x="12" y="6" width="116" height="66" rx="3" fill="url(#scr)"/>
      <path d="M58 78h24l3 12H55z" fill="#b8b8bd"/><rect x="46" y="89" width="48" height="4" rx="2" fill="#d2d2d7"/></svg>
    <h1>${esc(a.os)}</h1>
    <div class="ver">Version ${esc(a.version)}</div>
    <dl>
      <dt>Processor</dt><dd title="${esc(a.cpu)}">${esc(a.cpu)}</dd>
      <dt>Graphics</dt><dd title="${esc(a.gpu)}">${esc(a.gpu || '—')}</dd>
      <dt>Memory</dt><dd>${esc(a.memory)}</dd>
      <dt>Display</dt><dd>${esc(a.display)}</dd>
      <dt>Name</dt><dd>${esc(a.host)}</dd>
    </dl>
    <button class="pbtn" id="more">More Info…</button>
  </div>`;
  panel.querySelector('#close').addEventListener('click', () => api.send('popup:close'));
  panel.querySelector('#more').addEventListener('click', () => act(uri('ms-settings:about')));
  reportSize();
}

// ---------------------------------------------------------------- wallpaper picker
let previews = [];
function disposePreviews() {
  previews.forEach((p) => p.dispose());
  previews = [];
}

function seg(options, value, onChange) {
  const el = h('<div class="seg"></div>');
  for (const [v, label] of options) {
    const b = h(`<button class="${String(v) === String(value) ? 'on' : ''}">${esc(label)}</button>`);
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(v);
    });
    el.appendChild(b);
  }
  return el;
}

function srow(g, label, control, hint) {
  const r = h(`<div class="srow"><div class="lab"><span>${esc(label)}</span>${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div></div>`);
  r.appendChild(control);
  g.appendChild(r);
}

async function buildWallpaperPicker(my) {
  const s = await api.invoke('settings:get');
  if (my !== token) return;
  disposePreviews();
  setPanel('wallpaper');
  const w = s.wallpaper;
  const set = (k, v) => api.invoke('settings:set', `wallpaper.${k}`, v);
  const wrap = h(`<div class="wp-wrap">
      <div class="wp-head">
        <div><div class="wp-title">Wallpaper</div><div class="wp-sub">Live scenes behind your desktop icons — move the mouse, click the desktop, play music</div></div>
        <div class="wp-on"><span>Live Wallpaper</span></div>
      </div>
      <div class="wp-grid"></div>
      <div class="group wp-opts"></div>
      <div class="btn-row"><button class="pbtn primary" id="d">Done</button></div>
    </div>`);
  content.innerHTML = '';
  content.appendChild(wrap);
  const onToggle = toggle(w.on, (v) => {
    set('on', v);
    wrap.classList.toggle('off', !v);
  });
  wrap.querySelector('.wp-on').appendChild(onToggle);
  wrap.classList.toggle('off', !w.on);

  const grid = wrap.querySelector('.wp-grid');
  for (const sc of WallEngine.list()) {
    const card = h(`<div class="wp-card${sc.id === w.scene ? ' sel' : ''}" data-id="${sc.id}">
        <canvas></canvas><div class="wp-name">${esc(sc.name)}</div><div class="wp-desc">${esc(sc.desc)}</div></div>`);
    card.addEventListener('click', () => {
      grid.querySelectorAll('.wp-card').forEach((c) => c.classList.toggle('sel', c === card));
      set('scene', sc.id);
      if (!onToggle.classList.contains('on')) onToggle.click();
    });
    grid.appendChild(card);
  }

  const opts = wrap.querySelector('.wp-opts');
  srow(opts, 'Span Obsidian across displays', toggle(w.span, (v) => set('span', v)), 'Gummy Bears, Flux and Warp always span all monitors; Obsidian is drawn once per display when off (lighter)');
  srow(opts, 'React to music', toggle(w.audio, (v) => set('audio', v)), 'Listens to what is playing on this PC — nothing is recorded');
  srow(opts, 'React to mouse and clicks', toggle(w.mouse, (v) => set('mouse', v)));
  srow(opts, 'Quality', seg([['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High']], w.quality, (v) => set('quality', v)));
  srow(opts, 'Frame rate', seg([[30, '30'], [60, '60'], ['max', 'Max']], w.fps, (v) => set('fps', v)));
  wrap.querySelector('#d').addEventListener('click', () => api.send('popup:close'));
  reportSize();

  // Live previews of every scene (small, 30 fps, only while the picker is open).
  requestAnimationFrame(() => {
    if (my !== token) return;
    grid.querySelectorAll('.wp-card').forEach((card) => {
      const cv = card.querySelector('canvas');
      const eng = window.WallEngine && WallEngine.create(cv, { preview: true, fps: 30 });
      if (!eng) return;
      eng.configure({ scene: card.dataset.id });
      eng.start();
      cv.addEventListener('mousemove', (e) => eng.setMouse(e.offsetX, cv.clientHeight - e.offsetY));
      cv.addEventListener('mousedown', (e) => eng.click(e.offsetX, cv.clientHeight - e.offsetY));
      previews.push(eng);
    });
  });
}

// ---------------------------------------------------------------- dispatch
api.on('popup:show', (msg) => {
  token = msg.token;
  kind = msg.kind;
  appInfo = msg.app || appInfo;
  panelTop = msg.center ? 26 : 3;
  panel.style.top = panelTop + 'px';
  const my = token;
  disposePreviews();
  if (kind === 'control') buildControl(my);
  else if (kind === 'wallpaper') buildWallpaperPicker(my);
  else if (kind === 'settings') buildSettings(my);
  else if (kind === 'clock') buildClock(my);
  else if (kind === 'wifi') buildWifi(my);
  else if (kind === 'battery') buildBattery(my);
  else if (kind === 'about') buildAbout(my);
  else renderMenu(menuDefs(kind));
  reportSize();
});

api.on('popup:hidden', () => {
  menuItems = [];
  disposePreviews();
});
api.on('settings', (s) => {
  settings = s;
  LiquidGlass.setEnabled(!!s.appearance.liquidGlass);
});

(async function init() {
  settings = await api.invoke('settings:get');
  LiquidGlass.setEnabled(!!settings.appearance.liquidGlass);
  api.invoke('sys:about').then((a) => (userName = a.user));
  Glass.load();
})();
