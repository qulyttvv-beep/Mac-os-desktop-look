// "Liquid Glass" surfaces, rendered live on the GPU: whatever is behind an element (the
// live wallpaper, streamed from the wallpaper window ~30 times a second, or the static
// wallpaper) is refracted inward along the rounded edges like a thick glass lens, with a
// touch of colour dispersion at the rim, softly blurred and saturated; CSS adds the tint
// and the specular rim. Requires glass.js.
//
//   const item = LiquidGlass.attach(el, { band, scale, pointer })
//
// `el` must be positioned; the layers are added as its first/last children, so render
// dynamic content into a child element rather than replacing el.innerHTML.
(function () {
  const items = new Set();
  let enabled = false;
  let raf = 0;

  // ---- sources
  let live = null; // last frame piece from the wallpaper: { w, h, data, ver }
  let liveVer = 0;
  let port = null;
  window.addEventListener('message', (ev) => {
    if (!ev.data || ev.data.type !== 'glass:port' || !ev.ports.length) return;
    if (port) port.close();
    port = ev.ports[0];
    port.onmessage = (m) => {
      live = { ...m.data, ver: ++liveVer };
      schedule();
    };
  });

  function source() {
    const inf = window.Glass && Glass.info();
    if (live && inf && inf.live !== false) {
      return { kind: 'live', ver: 'l' + live.ver, map: [0, 0, 1 / window.innerWidth, 1 / window.innerHeight], texel: window.innerWidth / live.w };
    }
    const st = window.Glass && Glass.staticSource();
    if (!st) return null;
    return { kind: 'static', ver: 's' + st.ver, canvas: st.canvas, map: st.map, texel: 1 / st.scale };
  }

  // ---- GL
  const VS = `#version 300 es
in vec2 p;
out vec2 vUv;
void main() { vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uSize;    // element layout size (css px)
uniform vec3 uPos;     // element top-left in the window (css px), transform scale
uniform vec4 uMap;     // window px -> source uv: (w + xy) * zw
uniform float uR, uBand, uDisp, uBlur, uFrost;
vec3 tap(vec2 w) { return texture(uSrc, (w + uMap.xy) * uMap.zw).rgb; }
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec2 c = p - uSize * 0.5;
  vec2 hs = uSize * 0.5;
  float r = min(uR, min(hs.x, hs.y));
  vec2 q = abs(c) - (hs - r);
  float dist;
  vec2 n;
  if (q.x > 0.0 && q.y > 0.0) { float l = max(length(q), 1e-4); dist = l - r; n = q / l * sign(c); }
  else if (q.x > q.y) { dist = q.x - r; n = vec2(sign(c.x), 0.0); }
  else { dist = q.y - r; n = vec2(0.0, sign(c.y)); }
  // circular bevel: strong right at the rim, flat in the middle
  float t = 1.0 + min(dist, 0.0) / uBand;
  float m = t <= 0.0 ? 0.0 : 1.0 - sqrt(max(1.0 - t * t, 0.0));
  vec2 d = -n * m * uDisp * 0.5;
  vec2 w = uPos.xy + (p + d) * uPos.z;
  // frosting: a wider two-ring blur, a little smoke and calmer colour
  float b = uBlur + uFrost * 12.0;
  float b2 = b * 0.5;
  vec3 col = tap(w) * 2.0
    + (tap(w + vec2(b2, b2)) + tap(w + vec2(-b2, b2)) + tap(w + vec2(b2, -b2)) + tap(w + vec2(-b2, -b2))) * 1.5
    + tap(w + vec2(b, 0.0)) + tap(w + vec2(-b, 0.0)) + tap(w + vec2(0.0, b)) + tap(w + vec2(0.0, -b));
  col /= 12.0;
  vec2 dc = d * 0.14 * uPos.z;
  col.r = mix(col.r, tap(w + dc).r, m);
  col.b = mix(col.b, tap(w - dc).b, m);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(lum), col, mix(1.45, 1.1, uFrost)) * mix(1.04, 0.72, uFrost);
  o = vec4(max(col, 0.0), 1.0);
}`;

  function setupGL(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = {};
    for (const n of ['uSrc', 'uSize', 'uPos', 'uMap', 'uR', 'uBand', 'uDisp', 'uBlur', 'uFrost']) u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(u.uSrc, 0);
    return { gl, u };
  }

  function render(item) {
    const el = item.el;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const src = enabled && w && h ? source() : null;
    item.canvas.style.visibility = src ? 'visible' : 'hidden';
    if (!src) return;
    if (!item.g) {
      try {
        item.g = setupGL(item.canvas);
      } catch (e) {
        console.error('[liquid]', e);
      }
      if (!item.g) return;
    }
    const { gl, u } = item.g;
    // the glass is blurry by nature: three quarters of the device resolution is plenty
    const dpr = (window.devicePixelRatio || 1) * 0.75;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (item.canvas.width !== cw || item.canvas.height !== ch) {
      item.canvas.width = cw;
      item.canvas.height = ch;
    }
    if (item.ver !== src.ver) {
      item.ver = src.ver;
      if (src.kind === 'live') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, live.w, live.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, live.data);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.canvas);
    }
    const r = el.getBoundingClientRect();
    gl.viewport(0, 0, cw, ch);
    gl.uniform2f(u.uSize, w, h);
    gl.uniform3f(u.uPos, r.left, r.top, r.width / w);
    gl.uniform4f(u.uMap, src.map[0], src.map[1], src.map[2], src.map[3]);
    gl.uniform1f(u.uR, item.radius);
    gl.uniform1f(u.uBand, item.o.band);
    gl.uniform1f(u.uDisp, item.o.scale);
    gl.uniform1f(u.uBlur, src.texel * 0.6);
    gl.uniform1f(u.uFrost, item.o.frost);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function schedule() {
    if (raf || !enabled) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      items.forEach(render);
    });
  }

  function attach(el, opts = {}) {
    const o = Object.assign({ band: 16, scale: 36, pointer: false, frost: 0.3 }, opts);
    const layer = document.createElement('div');
    layer.className = 'lg-layer';
    const canvas = document.createElement('canvas');
    canvas.className = 'lg-refract';
    layer.appendChild(canvas);
    const rim = document.createElement('div');
    rim.className = 'lg-rim';
    el.prepend(layer);
    el.appendChild(rim);
    el.classList.add('lg');

    const item = { el, layer, canvas, rim, o, g: null, ver: null, radius: 0 };
    items.add(item);
    // GPU reset or too many contexts: rebuild the program once the context comes back.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      item.g = null;
      item.ver = null;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      item.g = null;
      item.ver = null;
      schedule();
    });
    new ResizeObserver(() => {
      item.radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      schedule();
    }).observe(el);

    if (o.pointer) {
      el.addEventListener('mousemove', (e) => highlight(item, e.clientX, e.clientY));
      el.addEventListener('mouseleave', () => highlight(item, null));
    }
    schedule();
    return item;
  }

  // Specular highlight that follows the pointer across the glass.
  function highlight(item, x, y) {
    if (x == null) {
      item.rim.style.removeProperty('--mx');
      item.rim.style.removeProperty('--my');
      return;
    }
    const r = item.el.getBoundingClientRect();
    item.rim.style.setProperty('--mx', `${x - r.left}px`);
    item.rim.style.setProperty('--my', `${y - r.top}px`);
  }

  function setEnabled(on) {
    enabled = !!on;
    document.documentElement.classList.toggle('lg-on', enabled);
    items.forEach((it) => (it.radius = parseFloat(getComputedStyle(it.el).borderTopLeftRadius) || 0));
    schedule();
  }

  if (window.Glass) {
    Glass.onChange(() => {
      if (Glass.info() && Glass.info().live === false) live = null;
      schedule();
    });
    Glass.onMove(schedule);
  }
  window.addEventListener('resize', schedule);

  // Average brightness (0..1) of the live picture behind a window rectangle, or null.
  function liveLuminance(x, y, w, h) {
    if (!live) return null;
    const k = live.w / window.innerWidth;
    const x0 = Math.max(0, Math.floor(x * k));
    const y0 = Math.max(0, Math.floor(y * k));
    const x1 = Math.min(live.w, Math.ceil((x + w) * k));
    const y1 = Math.min(live.h, Math.ceil((y + h) * k));
    let sum = 0;
    let n = 0;
    for (let j = y0; j < y1; j += 2) {
      for (let i = x0; i < x1; i += 2) {
        const o = (j * live.w + i) * 4;
        sum += (0.2126 * live.data[o] + 0.7152 * live.data[o + 1] + 0.0722 * live.data[o + 2]) / 255;
        n++;
      }
    }
    return n ? sum / n : null;
  }

  window.LiquidGlass = {
    attach,
    liveLuminance,
    setEnabled,
    updateAll: schedule,
    refresh: schedule,
    highlight,
    get enabled() {
      return enabled;
    },
  };
})();
