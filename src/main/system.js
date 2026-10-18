// System info for widgets and menus: CPU/RAM/disk, battery, weather, about, Wi-Fi.
const os = require('os');
const fs = require('fs');
const { app, screen } = require('electron');
const { execFile } = require('child_process');
const native = require('./native');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// ---- CPU sampling ----
let prevCpu = null;
let cpuPct = 0;
function sampleCpu() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const k of Object.keys(c.times)) total += c.times[k];
    idle += c.times.idle;
  }
  if (prevCpu) {
    const dIdle = idle - prevCpu.idle;
    const dTotal = total - prevCpu.total;
    if (dTotal > 0) cpuPct = Math.max(0, Math.min(100, 100 * (1 - dIdle / dTotal)));
  }
  prevCpu = { idle, total };
}
sampleCpu();
setInterval(sampleCpu, 2000).unref();

async function stats() {
  let disk = null;
  try {
    const s = await fs.promises.statfs(process.env.SystemDrive ? process.env.SystemDrive + '\\' : 'C:\\');
    const total = s.blocks * s.bsize;
    disk = { total, used: total - s.bavail * s.bsize };
  } catch {
    /* ignore */
  }
  const total = os.totalmem();
  return {
    cpu: Math.round(cpuPct),
    mem: { total, used: total - os.freemem() },
    disk,
    uptime: os.uptime(),
    power: native.powerStatus(),
  };
}

// ---- Weather (Open-Meteo, no API key) ----
const weatherCache = new Map();
async function weather(city, units) {
  if (!city) return { error: 'no-city' };
  const key = `${city.toLowerCase()}|${units}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.data;
  try {
    const g = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=${encodeURIComponent(city)}`
    ).then((r) => r.json());
    const place = g && g.results && g.results[0];
    if (!place) return { error: 'not-found' };
    const tempUnit = units === 'f' ? 'fahrenheit' : 'celsius';
    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,weather_code,is_day,apparent_temperature,wind_speed_10m,relative_humidity_2m` +
        `&daily=temperature_2m_max,temperature_2m_min,weather_code&hourly=temperature_2m,weather_code` +
        `&forecast_days=2&timezone=auto&temperature_unit=${tempUnit}`
    ).then((r) => r.json());
    if (!w || !w.current) return { error: 'failed' };
    const nowIdx = Math.max(0, (w.hourly.time || []).findIndex((t) => t >= w.current.time.slice(0, 13)));
    const data = {
      place: place.name,
      country: place.country_code,
      temp: w.current.temperature_2m,
      feels: w.current.apparent_temperature,
      code: w.current.weather_code,
      isDay: !!w.current.is_day,
      wind: w.current.wind_speed_10m,
      humidity: w.current.relative_humidity_2m,
      hi: w.daily.temperature_2m_max[0],
      lo: w.daily.temperature_2m_min[0],
      hourly: (w.hourly.time || []).slice(nowIdx, nowIdx + 6).map((t, i) => ({
        time: t,
        temp: w.hourly.temperature_2m[nowIdx + i],
        code: w.hourly.weather_code[nowIdx + i],
      })),
      units,
    };
    weatherCache.set(key, { t: Date.now(), data });
    return data;
  } catch (e) {
    return { error: 'offline' };
  }
}

// ---- About This PC ----
let aboutCache = null;
async function about() {
  if (aboutCache) return aboutCache;
  const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion']);
  const val = (name) => {
    const m = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'mi').exec(out);
    return m ? m[1].trim() : '';
  };
  const build = parseInt(val('CurrentBuildNumber') || val('CurrentBuild') || '0', 10);
  const edition = { Core: 'Home', Professional: 'Pro', Enterprise: 'Enterprise', Education: 'Education' }[val('EditionID')] || val('EditionID');
  let gpu = '';
  try {
    const info = await app.getGPUInfo('complete');
    const r = (info.auxAttributes && info.auxAttributes.glRenderer) || '';
    const m = /ANGLE \(([^,]+),\s*([^(]+?)\s*(\(|Direct3D|$)/.exec(r);
    gpu = m ? m[2].trim() : r;
  } catch {
    /* ignore */
  }
  const d = screen.getPrimaryDisplay();
  aboutCache = {
    os: `Windows ${build >= 22000 ? 11 : 10} ${edition}`.trim(),
    version: `${val('DisplayVersion') || ''} (Build ${build}${val('UBR') ? '.' + parseInt(val('UBR'), 16) : ''})`.trim(),
    cpu: (os.cpus()[0] || {}).model ? os.cpus()[0].model.trim() : 'Unknown',
    cores: os.cpus().length,
    memory: `${Math.round(os.totalmem() / 1024 ** 3)} GB`,
    gpu,
    display: `${Math.round(d.size.width * d.scaleFactor)} × ${Math.round(d.size.height * d.scaleFactor)}`,
    host: os.hostname(),
    user: os.userInfo().username,
  };
  return aboutCache;
}

async function wifi() {
  const out = await run('netsh', ['wlan', 'show', 'interfaces']);
  const ssid = /^\s*SSID\s*:\s*(.+)$/m.exec(out);
  const state = /^\s*State\s*:\s*(.+)$/m.exec(out);
  const signal = /^\s*Signal\s*:\s*(\d+)%/m.exec(out);
  return {
    hasWifi: !!state,
    connected: !!(state && /connected/i.test(state[1]) && !/disconnected/i.test(state[1])),
    ssid: ssid ? ssid[1].trim() : null,
    signal: signal ? parseInt(signal[1], 10) : null,
  };
}

module.exports = { stats, weather, about, wifi, run };
