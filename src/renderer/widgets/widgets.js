const name = api.query.w;
const W = document.getElementById('w'); // the card (glass layers live here)
const C = document.getElementById('c'); // the widget's content
const root = document.documentElement;
const PAD = 30; // must match WIDGET_PAD in main.js
let settings = null;

W.classList.add(name === 'calendar' || name === 'system' ? 'medium' : 'small', `w-${name}`);
const lg = LiquidGlass.attach(W, { band: 18, scale: 44, frost: 0.85 });

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ------------------------------------------------------------------ appearance
function applyAppearance() {
  const a = settings.appearance || {};
  const glass = a.widgetStyle !== 'classic';
  root.classList.toggle('wg-glass', glass);
  root.classList.toggle('wg-classic', !glass);
  W.classList.toggle('glass', glass);
  LiquidGlass.setEnabled(glass && !!a.liquidGlass);
  adaptTint();
}

// Darken the glass over bright or busy wallpaper so white text stays readable — judged
// from the live wallpaper behind the widget when there is one.
function adaptTint() {
  if (!root.classList.contains('wg-glass')) return;
  const live = LiquidGlass.liveLuminance(PAD, PAD, W.offsetWidth, W.offsetHeight);
  const lum = live != null ? live : Glass.luminance(PAD, PAD, W.offsetWidth, W.offsetHeight);
  const a = Math.min(0.42, 0.1 + lum * 0.55);
  const tint = `rgba(0,0,0,${a.toFixed(2)})`;
  const frost = `rgba(0,0,0,${Math.min(0.5, a + 0.08).toFixed(2)})`;
  root.style.setProperty('--auto-tint', tint);
  root.style.setProperty('--auto-frost', frost);
}
let tintT = null;
Glass.onChange(adaptTint);
setInterval(adaptTint, 1500); // the live wallpaper keeps changing underneath
Glass.onMove(() => {
  clearTimeout(tintT);
  tintT = setTimeout(adaptTint, 250);
});

// ------------------------------------------------------------------ dragging
// We drive the drag ourselves (instead of an OS drag region) so the main process can
// lift the widget, snap it into the grid and animate it into place on release.
let down = null;
let dragging = false;
W.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.nodrag')) return;
  down = { x: e.screenX, y: e.screenY };
  W.setPointerCapture(e.pointerId);
});
W.addEventListener('pointermove', (e) => {
  if (!down || dragging) return;
  if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 3) {
    dragging = true;
    api.send('widget:drag-start');
  }
});
const release = () => {
  if (dragging) api.send('widget:drag-end');
  down = null;
  dragging = false;
};
W.addEventListener('pointerup', release);
W.addEventListener('pointercancel', release);
api.on('widget:drag', (on) => W.classList.toggle('lifted', on));

W.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.send('widget:menu', name);
});

// ------------------------------------------------------------------ clock
function clock() {
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    ticks += `<line x1="50" y1="4.5" x2="50" y2="${major ? 8.5 : 6.5}" stroke="var(--tick)" stroke-width="${major ? 1.1 : 0.6}" transform="rotate(${i * 6} 50 50)"/>`;
  }
  let nums = '';
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    nums += `<text class="num" x="${(50 + Math.sin(a) * 36).toFixed(2)}" y="${(50 - Math.cos(a) * 36).toFixed(2)}">${h}</text>`;
  }
  C.innerHTML = `<svg viewBox="0 0 100 100">
    ${ticks}${nums}
    <g class="hand" id="hh"><line x1="50" y1="52" x2="50" y2="28" stroke="var(--hand)" stroke-width="3.4" stroke-linecap="round"/></g>
    <g class="hand" id="mh"><line x1="50" y1="53" x2="50" y2="15" stroke="var(--hand)" stroke-width="2.4" stroke-linecap="round"/></g>
    <circle cx="50" cy="50" r="2.6" fill="var(--hand)"/>
    <g class="hand" id="sh"><line x1="50" y1="59" x2="50" y2="11" stroke="#ff9500" stroke-width="1" stroke-linecap="round"/></g>
    <circle cx="50" cy="50" r="1.5" fill="#ff9500"/>
  </svg>`;
  const hh = document.getElementById('hh');
  const mh = document.getElementById('mh');
  const sh = document.getElementById('sh');
  // Quartz-style tick: one repaint per second keeps the widget nearly free.
  const update = () => {
    const d = new Date();
    const s = d.getSeconds();
    const m = d.getMinutes() + s / 60;
    const hr = (d.getHours() % 12) + m / 60;
    hh.style.transform = `rotate(${hr * 30}deg)`;
    mh.style.transform = `rotate(${m * 6}deg)`;
    sh.style.transform = `rotate(${s * 6}deg)`;
    setTimeout(update, 1000 - (Date.now() % 1000) + 2);
  };
  update();
}

// ------------------------------------------------------------------ weather
const WMO = {
  0: ['Clear', '☀️', '🌙', 'clear'],
  1: ['Mostly Clear', '🌤️', '🌙', 'clear'],
  2: ['Partly Cloudy', '⛅', '☁️', 'cloudy'],
  3: ['Cloudy', '☁️', '☁️', 'cloudy'],
  45: ['Fog', '🌫️', '🌫️', 'fog'],
  48: ['Fog', '🌫️', '🌫️', 'fog'],
  51: ['Drizzle', '🌦️', '🌧️', 'rain'],
  53: ['Drizzle', '🌦️', '🌧️', 'rain'],
  55: ['Drizzle', '🌧️', '🌧️', 'rain'],
  56: ['Freezing Drizzle', '🌧️', '🌧️', 'rain'],
  57: ['Freezing Drizzle', '🌧️', '🌧️', 'rain'],
  61: ['Light Rain', '🌦️', '🌧️', 'rain'],
  63: ['Rain', '🌧️', '🌧️', 'rain'],
  65: ['Heavy Rain', '🌧️', '🌧️', 'rain'],
  66: ['Freezing Rain', '🌧️', '🌧️', 'rain'],
  67: ['Freezing Rain', '🌧️', '🌧️', 'rain'],
  71: ['Light Snow', '🌨️', '🌨️', 'snow'],
  73: ['Snow', '🌨️', '🌨️', 'snow'],
  75: ['Heavy Snow', '❄️', '❄️', 'snow'],
  77: ['Snow Grains', '🌨️', '🌨️', 'snow'],
  80: ['Showers', '🌦️', '🌧️', 'rain'],
  81: ['Showers', '🌧️', '🌧️', 'rain'],
  82: ['Heavy Showers', '🌧️', '🌧️', 'rain'],
  85: ['Snow Showers', '🌨️', '🌨️', 'snow'],
  86: ['Snow Showers', '🌨️', '🌨️', 'snow'],
  95: ['Thunderstorms', '⛈️', '⛈️', 'storm'],
  96: ['Thunderstorms', '⛈️', '⛈️', 'storm'],
  99: ['Thunderstorms', '⛈️', '⛈️', 'storm'],
};
const WX_CLASSES = ['clear-day', 'clear-night', 'cloudy-day', 'cloudy-night', 'rain', 'snow', 'storm', 'fog'];
const ARROW = '<svg viewBox="0 0 10 10"><path d="M9.5.5L.8 4.4l4 .9.9 4z" fill="currentColor"/></svg>';

function setSky(cls) {
  W.classList.remove(...WX_CLASSES);
  if (cls) W.classList.add(cls);
}

function resolvedUnits() {
  const u = settings.widgets.weather.units;
  if (u === 'c' || u === 'f') return u;
  // Many people outside the US use an en-US Windows install, so judge by where the clock is set.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const usZone = /^(America\/(New_York|Chicago|Denver|Phoenix|Los_Angeles|Anchorage|Detroit|Boise|Indiana|Kentucky|North_Dakota|Menominee|Juneau|Sitka|Nome|Adak|Metlakatla|Yakutat)|Pacific\/Honolulu|US\/)/.test(tz);
  return usZone || /^(Pacific\/(Palau|Guam|Saipan)|America\/(Nassau|Belize|Cayman))/.test(tz) ? 'f' : 'c';
}

// Until the user picks a city, guess one from the system time zone (no network lookup).
function tzCity() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (!tz.includes('/') || /^(Etc|UTC|GMT)/i.test(tz)) return '';
    return tz.split('/').pop().replace(/_/g, ' ');
  } catch {
    return '';
  }
}

function weatherPrompt(msg) {
  setSky('cloudy-day');
  C.innerHTML = `<div><div class="wx-city">Weather</div><div class="wx-msg" style="margin-top:6px">${esc(msg)}</div></div>
    <input class="wx-input nodrag" placeholder="Type a city…" spellcheck="false">`;
  const inp = C.querySelector('input');
  inp.value = settings.widgets.weather.city || tzCity();
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inp.value.trim()) api.invoke('settings:set', 'widgets.weather.city', inp.value.trim());
    if (e.key === 'Escape' && (settings.widgets.weather.city || tzCity())) loadWeather();
  });
  setTimeout(() => inp.focus(), 50);
}

let wxTimer = null;
let wxKey = '';
let wxFails = 0;
async function loadWeather() {
  clearTimeout(wxTimer);
  wxTimer = setTimeout(loadWeather, 15 * 60 * 1000);
  const city = settings.widgets.weather.city || tzCity();
  if (!city) return weatherPrompt('Set your location to see the forecast.');
  const units = resolvedUnits();
  const d = await api.invoke('sys:weather', city, units);
  if (d.error) {
    if (d.error === 'not-found') return weatherPrompt(`Couldn't find “${city}”. Try another city.`);
    setSky('cloudy-day');
    C.innerHTML = `<div class="wx-city">${esc(city)}</div><div class="wx-msg">Weather unavailable.<br>Will retry soon.</div>`;
    clearTimeout(wxTimer);
    wxFails += 1;
    wxTimer = setTimeout(loadWeather, (wxFails < 3 ? 15 : 60) * 1000); // network may not be up yet at login
    return;
  }
  wxFails = 0;
  const [cond, dayIc, nightIc, group] = WMO[d.code] || ['—', '🌡️', '🌡️', 'cloudy'];
  setSky(group === 'clear' || group === 'cloudy' ? `${group}-${d.isDay ? 'day' : 'night'}` : group);
  const t = (v) => `${Math.round(v)}°`;
  C.innerHTML = `
    <div>
      <div class="wx-city">${esc(d.place)} ${ARROW}</div>
      <div class="wx-temp">${t(d.temp)}</div>
    </div>
    <div>
      <div class="wx-ic">${d.isDay ? dayIc : nightIc}</div>
      <div class="wx-cond">${esc(cond)}</div>
      <div class="wx-hl">H:${t(d.hi)} L:${t(d.lo)}</div>
    </div>`;
}

function weather() {
  wxKey = JSON.stringify(settings.widgets.weather);
  loadWeather();
  api.on('widget:edit', () => weatherPrompt('Change location:'));
  api.on('settings', () => {
    const k = JSON.stringify(settings.widgets.weather);
    if (k !== wxKey) {
      wxKey = k;
      loadWeather();
    }
  });
}

// ------------------------------------------------------------------ calendar
function calendar() {
  const draw = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const first = new Date(y, m, 1).getDay();
    const daysIn = new Date(y, m + 1, 0).getDate();
    const dayOfYear = Math.floor((now - new Date(y, 0, 1)) / 86400000) + 1;
    const tmp = new Date(Date.UTC(y, m, now.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const week = Math.ceil(((tmp - new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
    const dows = [...Array(7)].map((_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));
    let cells = dows.map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < first; i++) cells += '<div></div>';
    for (let d = 1; d <= daysIn; d++) {
      const dow = (first + d - 1) % 7;
      cells += `<div class="d${dow === 0 || dow === 6 ? ' we' : ''}${d === now.getDate() ? ' today' : ''}"><span>${d}</span></div>`;
    }
    C.innerHTML = `
      <div class="cal-left">
        <div class="wd">${esc(now.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase())}</div>
        <div class="day">${now.getDate()}</div>
        <div class="meta">${esc(now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}<br>Week ${week} · Day ${dayOfYear}</div>
      </div>
      <div class="cal-right">
        <div class="mon">${esc(now.toLocaleDateString(undefined, { month: 'long' }).toUpperCase())}</div>
        <div class="mgrid">${cells}</div>
      </div>`;
    const next = new Date(y, m, now.getDate() + 1, 0, 0, 2);
    setTimeout(draw, Math.min(next - now, 60 * 60 * 1000));
  };
  draw();
}

// ------------------------------------------------------------------ system
function ring(id, label, color) {
  const Cf = 2 * Math.PI * 25;
  return `<div class="ring"><div class="holder">
      <svg viewBox="0 0 62 62"><circle class="bg" cx="31" cy="31" r="25" fill="none" stroke-width="7"/>
      <circle class="fg" id="${id}" cx="31" cy="31" r="25" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${Cf}" stroke-dashoffset="${Cf}"/></svg>
      <div class="val" id="${id}v">–</div></div><div class="lbl">${label}</div></div>`;
}

function setRing(id, pct, color) {
  const Cf = 2 * Math.PI * 25;
  const el = document.getElementById(id);
  el.style.strokeDashoffset = Cf * (1 - Math.max(0.005, Math.min(1, pct / 100)));
  if (color) el.style.stroke = color;
  document.getElementById(id + 'v').textContent = `${Math.round(pct)}%`;
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function system() {
  C.innerHTML = `<div class="sys-title"><span>System</span><span id="up"></span></div>
    <div class="sys-rings">${ring('cpu', 'CPU', '#34c759')}${ring('mem', 'Memory', '#0a84ff')}${ring('dsk', 'Disk', '#bf5af2')}${ring('bat', 'Battery', '#34c759')}</div>`;
  const batRing = document.getElementById('bat').closest('.ring');
  const update = async () => {
    const s = await api.invoke('sys:stats');
    const cpuColor = s.cpu > 85 ? '#ff3b30' : s.cpu > 60 ? '#ff9500' : '#34c759';
    setRing('cpu', s.cpu, cpuColor);
    setRing('mem', (s.mem.used / s.mem.total) * 100);
    if (s.disk) setRing('dsk', (s.disk.used / s.disk.total) * 100);
    if (s.power && s.power.hasBattery && s.power.percent != null) {
      setRing('bat', s.power.percent, s.power.percent <= 20 && !s.power.plugged ? '#ff3b30' : '#34c759');
    } else {
      const gb = (b) => (b / 1024 ** 3).toFixed(1);
      batRing.querySelector('.holder').innerHTML = `<div style="text-align:center;line-height:1.35;font-size:11.5px;font-variant-numeric:tabular-nums">
          <div style="font-size:18px;font-weight:650">${gb(s.mem.used)}</div><div style="color:var(--text-2)">of ${gb(s.mem.total)} GB</div></div>`;
      batRing.querySelector('.lbl').textContent = 'RAM used';
    }
    document.getElementById('up').textContent = `Up ${fmtUptime(s.uptime)}`;
  };
  update();
  setInterval(update, 2000);
}

// ------------------------------------------------------------------ notes
function notes() {
  C.innerHTML = `<div class="notes-h">NOTES</div><textarea class="notes-t nodrag" spellcheck="false" placeholder="Write something…"></textarea>`;
  const ta = C.querySelector('textarea');
  ta.value = settings.widgets.notes.text || '';
  let t = null;
  ta.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => api.send('notes:save', ta.value), 400);
  });
  api.on('widget:set-text', (v) => (ta.value = v));
}

// ------------------------------------------------------------------
let lastAppearance = '';
api.on('settings', (s) => {
  settings = s;
  const a = JSON.stringify(s.appearance);
  if (a !== lastAppearance) {
    lastAppearance = a;
    applyAppearance();
  }
});

(async function init() {
  settings = await api.invoke('settings:get');
  lastAppearance = JSON.stringify(settings.appearance);
  applyAppearance();
  ({ clock, weather, calendar, system, notes })[name]();
  await Glass.load();
  adaptTint();
})();
