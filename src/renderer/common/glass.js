// Builds a frosted copy of the desktop wallpaper and exposes it as CSS variables:
//   --wall        heavily frosted (classic vibrancy)
// plus --wall-size / --wall-pos to pin it to screen coordinates. Liquid Glass gets a
// lightly softened copy on demand (staticSource) when the live wallpaper isn't running.
(function () {
  let objectUrls = [];
  let ctx = null;
  let info = null;
  let img = null;
  let clear = null;
  let ver = 0;
  const SCALE = 0.25;
  const listeners = new Set();
  const moveListeners = new Set();

  async function toUrl(canvas, q) {
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
    return URL.createObjectURL(blob);
  }

  function drawCover(c, img, filter) {
    const g = c.getContext('2d', { willReadFrequently: true });
    const r = Math.max(c.width / img.width, c.height / img.height);
    const dw = img.width * r;
    const dh = img.height * r;
    const dx = (c.width - dw) / 2;
    const dy = (c.height - dh) / 2;
    g.drawImage(img, dx, dy, dw, dh); // sharp copy underneath avoids dark blurred edges
    g.filter = filter;
    g.drawImage(img, dx, dy, dw, dh);
    g.filter = 'none';
    return g;
  }

  async function load() {
    try {
      info = await api.invoke('wallpaper:get');
    } catch {
      info = null;
    }
    const root = document.documentElement;
    if (!info || !info.url) {
      root.classList.add('no-wall');
      listeners.forEach((fn) => fn());
      return;
    }
    const im = new Image();
    im.src = info.url;
    try {
      await im.decode();
    } catch {
      root.classList.add('no-wall');
      return;
    }
    img = im;
    clear = null;
    ver++;
    const SW = info.screen.w;
    const SH = info.screen.h;

    const frosted = document.createElement('canvas');
    frosted.width = Math.max(1, Math.round(SW * SCALE));
    frosted.height = Math.max(1, Math.round(SH * SCALE));
    ctx = drawCover(frosted, im, 'blur(10px) saturate(1.8)');

    const u1 = await toUrl(frosted, 0.92);
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [u1];
    root.style.setProperty('--wall', `url(${u1})`);
    root.style.setProperty('--wall-size', `${SW}px ${SH}px`);
    root.style.setProperty('--wall-pos', `${-info.win.x}px ${-info.win.y}px`);
    root.classList.remove('no-wall');
    listeners.forEach((fn) => fn());
  }

  // Average luminance (0..1) of a window-relative rectangle of the wallpaper.
  function luminance(x, y, w, h) {
    if (!ctx || !info) return 0.5;
    const sx = Math.max(0, Math.floor((info.win.x + x) * SCALE));
    const sy = Math.max(0, Math.floor((info.win.y + y) * SCALE));
    const sw = Math.max(1, Math.floor(w * SCALE));
    const sh = Math.max(1, Math.floor(h * SCALE));
    const d = ctx.getImageData(sx, sy, sw, sh).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    return sum / (d.length / 4);
  }

  // Lightly softened wallpaper for Liquid Glass (built on first use, half resolution).
  function staticSource() {
    if (!img || !info) return null;
    if (!clear) {
      clear = document.createElement('canvas');
      clear.width = Math.max(1, Math.round(info.screen.w * 0.5));
      clear.height = Math.max(1, Math.round(info.screen.h * 0.5));
      drawCover(clear, img, 'blur(1.6px)');
    }
    return { canvas: clear, ver, scale: clear.width / info.screen.w, map: [info.win.x, info.win.y, 1 / info.screen.w, 1 / info.screen.h] };
  }

  api.on('wallpaper', load);
  // Window moved: re-pin the backdrop to screen coordinates.
  api.on('win:pos', (p) => {
    if (!info) return;
    info.win = p;
    document.documentElement.style.setProperty('--wall-pos', `${-p.x}px ${-p.y}px`);
    moveListeners.forEach((fn) => fn());
  });
  window.Glass = {
    load,
    luminance,
    info: () => info,
    staticSource,
    onChange: (fn) => listeners.add(fn),
    onMove: (fn) => moveListeners.add(fn),
  };
})();
