// The live-wallpaper window. The main process sends config and input; Liquid Glass
// windows subscribe with a MessagePort and get their piece of every new frame.
const subs = new Map(); // window id -> { port, x, y, w, h (frame DIP, top-down), visible }
let lastFeed = null;

// Cut each subscriber's rectangle out of the small frame (rows arrive bottom-up) and post it.
function sendFeed(f, only) {
  lastFeed = f;
  const k = f.w / f.dipW;
  for (const [id, s] of subs) {
    if (only && !only.has(id)) continue;
    if (!s.port || !s.visible || !(s.w > 0) || !(s.h > 0)) continue;
    const cw = Math.max(1, Math.round(s.w * k));
    const ch = Math.max(1, Math.round(s.h * k));
    const x0 = Math.round(s.x * k);
    const y0 = Math.round(s.y * k);
    const xa = Math.max(0, x0);
    const xb = Math.min(f.w, x0 + cw);
    const out = new Uint8ClampedArray(cw * ch * 4);
    if (xb > xa) {
      for (let j = 0; j < ch; j++) {
        const fy = f.h - 1 - (y0 + j);
        if (fy < 0 || fy >= f.h) continue;
        out.set(f.data.subarray((fy * f.w + xa) * 4, (fy * f.w + xb) * 4), (j * cw + (xa - x0)) * 4);
      }
    }
    s.port.postMessage({ w: cw, h: ch, data: out }, [out.buffer]);
  }
}

const engine = WallEngine.create(document.getElementById('c'), { onFeed: sendFeed });
let cfg = null;
let audioOn = false;

function applyAudio() {
  const want = !!(cfg && cfg.audio && !cfg.paused);
  if (!want && audioOn) engine.setAudio({ bass: 0, mid: 0, treble: 0, level: 0 });
  audioOn = want;
}
// band levels of what's playing, from the helper process (see audio.js)
api.on('wall:levels', (lv) => {
  if (audioOn && engine) engine.setAudio(AudioReact.process({ bass: lv.b || 0, mid: lv.m || 0, treble: lv.t || 0 }));
});

window.addEventListener('message', (ev) => {
  if (!ev.data || ev.data.type !== 'wall:port' || !ev.ports.length) return;
  const s = subs.get(ev.data.id) || {};
  if (s.port) s.port.close();
  s.port = ev.ports[0];
  subs.set(ev.data.id, s);
  if (lastFeed) sendFeed(lastFeed, new Set([ev.data.id]));
});
api.on('wall:subs', (list) => {
  const ids = new Set();
  const changed = new Set();
  for (const it of list) {
    ids.add(it.id);
    const old = subs.get(it.id) || {};
    if (old.x !== it.x || old.y !== it.y || old.w !== it.w || old.h !== it.h || old.visible !== it.visible) changed.add(it.id);
    subs.set(it.id, Object.assign(old, it));
  }
  for (const [id, s] of subs) {
    if (ids.has(id)) continue;
    if (s.port) s.port.close();
    subs.delete(id);
  }
  // a window moved or appeared: give it its piece now, even if the scene is resting
  if (lastFeed && changed.size) sendFeed(lastFeed, changed);
});

if (engine) {
  api.on('wall:config', (c) => {
    cfg = c;
    engine.configure({ scene: c.scene, quality: c.quality, fps: c.fps === 'max' ? 240 : Number(c.fps) || 60, layout: c.layout, span: c.span });
    engine.setPaused(c.paused);
    applyAudio();
  });
  api.on('wall:mouse', (p) => engine.setScreenMouse(p.x, p.y));
  api.on('wall:click', (p) => engine.screenClick(p.x, p.y));
  engine.start();
}
