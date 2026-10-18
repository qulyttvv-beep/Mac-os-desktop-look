// Tiny WebGL2 engine shared by the live wallpaper windows and the picker previews.
//
// Coordinates: every scene can work in *global* DIP space with the origin at the
// bottom-left of the whole span (both monitors), so shader-based scenes continue
// seamlessly across displays. gpos() in GLSL returns that position for a fragment.
(function () {
  const scenes = {};
  const order = [];
  const QUALITY = { low: 0.5, balanced: 0.75, high: 1 };

  const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uRes;      // canvas pixels
uniform float uTime;    // seconds, synced across displays
uniform float uScale;   // canvas pixels per DIP
uniform vec2 uOffset;   // this canvas' bottom-left in global DIP
uniform vec2 uTotal;    // size of the global space (DIP)
uniform vec2 uFocus;    // scene centre in global DIP (primary display centre)
uniform vec4 uMouse;    // global xy (DIP), activity 0..1, speed (DIP/s)
uniform vec2 uLook;     // smoothed pointer offset from focus, -1..1
uniform vec4 uAudio;    // bass, mid, treble, beat (all 0..1)
uniform vec3 uClick;    // global xy of last desktop click, seconds since
out vec4 outColor;
vec2 gpos() { return gl_FragCoord.xy / uScale + uOffset; }
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3. - 2. * f);
  float n000 = hash12(i.xy + i.z * 57.1), n100 = hash12(i.xy + vec2(1, 0) + i.z * 57.1);
  float n010 = hash12(i.xy + vec2(0, 1) + i.z * 57.1), n110 = hash12(i.xy + vec2(1, 1) + i.z * 57.1);
  float n001 = hash12(i.xy + (i.z + 1.) * 57.1), n101 = hash12(i.xy + vec2(1, 0) + (i.z + 1.) * 57.1);
  float n011 = hash12(i.xy + vec2(0, 1) + (i.z + 1.) * 57.1), n111 = hash12(i.xy + vec2(1, 1) + (i.z + 1.) * 57.1);
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fbm(vec2 p) { float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; } return v; }
float fbm3(vec3 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise3(p); p = p * 2.03 + 11.7; a *= .5; } return v; }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); }
// Filmic finish: tone map, gamma, per-display vignette, fine grain (also kills banding).
vec3 finish(vec3 col, float vignette) {
  col = aces(col);
  col = pow(col, vec3(1. / 2.2));
  vec2 v = gl_FragCoord.xy / uRes - .5;
  col *= 1. - vignette * dot(v, v) * 1.6;
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.) * 311.) - .5) * (1.6 / 255.);
  return max(col, 0.);
}
`;

  const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * .5 + .5; gl_Position = vec4(aPos, 0., 1.); }`;

  function register(def) {
    scenes[def.id] = def;
    if (!order.includes(def.id)) order.push(def.id);
  }

  function create(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: !!opts.preserve,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    const floatOK = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const vs = shader(gl, gl.VERTEX_SHADER, VS);

    // ---------------------------------------------------------------- helpers for scenes
    const G = {
      gl,
      floatOK,
      program(fsBody, { raw = false } = {}) {
        const fs = shader(gl, gl.FRAGMENT_SHADER, raw ? fsBody : HEADER + fsBody);
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, 'aPos');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const locs = {};
        return {
          p,
          u(name) {
            if (!(name in locs)) locs[name] = gl.getUniformLocation(p, name);
            return locs[name];
          },
        };
      },
      fbo(w, h, { internal = gl.RGBA16F, format = gl.RGBA, type = gl.HALF_FLOAT, filter = gl.LINEAR } = {}) {
        if (!floatOK && type !== gl.UNSIGNED_BYTE) {
          internal = gl.RGBA8;
          format = gl.RGBA;
          type = gl.UNSIGNED_BYTE;
        }
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        return {
          tex,
          fb,
          w,
          h,
          texel: [1 / w, 1 / h],
          attach(unit) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            return unit;
          },
          dispose() {
            gl.deleteTexture(tex);
            gl.deleteFramebuffer(fb);
          },
        };
      },
      double(w, h, o) {
        const d = { read: G.fbo(w, h, o), write: G.fbo(w, h, o) };
        d.swap = () => ([d.read, d.write] = [d.write, d.read]);
        d.dispose = () => (d.read.dispose(), d.write.dispose());
        d.w = w;
        d.h = h;
        d.texel = [1 / w, 1 / h];
        return d;
      },
      // Draw a fullscreen pass with `prog` into `target` (fbo or null for the canvas).
      // On the canvas, each visible display is drawn separately (covered ones are skipped);
      // with spanning off every display gets its own local frame.
      draw(prog, target, setup) {
        gl.useProgram(prog.p);
        gl.bindVertexArray(vao);
        if (target) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
          gl.viewport(0, 0, target.w, target.h);
          if (setup) setup(prog);
          // Full-screen offscreen passes (HDR scene buffers) skip covered displays too.
          const views = !st.mirror && target.w === canvas.width && target.h === canvas.height ? viewList() : null;
          if (!views) {
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            return;
          }
          gl.enable(gl.SCISSOR_TEST);
          for (const v of views) {
            gl.scissor(v.sx, v.sy, v.sw, v.sh);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
          gl.disable(gl.SCISSOR_TEST);
          return;
        }
        st.drew = true;
        if (st.mirror) {
          // per-display mode: the scene draws one display-sized frame, copied out later
          gl.bindFramebuffer(gl.FRAMEBUFFER, st.mirror.fb);
          gl.viewport(0, 0, st.mirror.w, st.mirror.h);
          if (setup) setup(prog);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          return;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        if (setup) setup(prog);
        const views = viewList();
        if (!views) {
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          return;
        }
        gl.enable(gl.SCISSOR_TEST);
        for (const v of views) {
          gl.scissor(v.sx, v.sy, v.sw, v.sh);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        gl.disable(gl.SCISSOR_TEST);
      },
      // Standard uniforms (see HEADER).
      common(prog, f) {
        gl.uniform2f(prog.u('uRes'), f.width, f.height);
        gl.uniform1f(prog.u('uTime'), f.time);
        gl.uniform1f(prog.u('uScale'), f.scale);
        gl.uniform2f(prog.u('uOffset'), f.offset[0], f.offset[1]);
        gl.uniform2f(prog.u('uTotal'), f.total[0], f.total[1]);
        gl.uniform2f(prog.u('uFocus'), f.focus[0], f.focus[1]);
        gl.uniform4f(prog.u('uMouse'), f.mouse.gx, f.mouse.gy, f.mouse.active, f.mouse.speed);
        gl.uniform2f(prog.u('uLook'), f.look[0], f.look[1]);
        gl.uniform4f(prog.u('uAudio'), f.audio.bass, f.audio.mid, f.audio.treble, f.audio.beat);
        gl.uniform3f(prog.u('uClick'), f.click.gx, f.click.gy, f.click.age);
      },
    };

    // ---------------------------------------------------------------- state
    const st = {
      sceneId: null,
      inst: null,
      quality: opts.quality || 'balanced',
      fps: opts.fps || 60,
      paused: false,
      preview: !!opts.preview,
      span: true,
      layout: null,
      last: 0,
      raf: 0,
      mouse: { gx: -1e4, gy: -1e4, pgx: -1e4, pgy: -1e4, vx: 0, vy: 0, speed: 0, activeUntil: 0, inside: false },
      look: [0, 0],
      clicks: [],
      click: { gx: -1e4, gy: -1e4, at: -1e4 },
      audio: { bass: 0, mid: 0, treble: 0, level: 0, beat: 0 },
      mirror: null, // display-sized frame (spanning off), copied onto every visible display
      fw: 0,
      fh: 0,
      drew: false,
    };

    const blitP = G.program(`
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uMap;
void main() { outColor = vec4(texture(uTex, uMap.xy + vUv * uMap.zw).rgb, 1.0); }`);

    // Visible displays as scissor rects (canvas pixels), or null for "whole canvas".
    function viewList() {
      const L = st.layout;
      if (st.preview || !L || !L.displays || !L.displays.length) return null;
      const k = canvas.width / (canvas.clientWidth || 1);
      return L.displays
        .filter((d) => !d.covered)
        .map((d) => ({
          d,
          sx: Math.floor(d.x * k),
          sy: Math.floor(d.y * k),
          sw: Math.ceil(d.w * k) + 1,
          sh: Math.ceil(d.h * k) + 1,
        }));
    }

    // Spanning off: the scene is rendered once, for the reference (primary) display, and
    // that frame is shown on every display — half the GPU work on two monitors.
    // Scenes made as panoramas (def.span) always stretch over every display.
    function mirrorRef() {
      const L = st.layout;
      const def = scenes[st.sceneId];
      if (st.span || (def && def.span) || st.preview || !L || !L.displays || !L.displays.length) return null;
      return L.displays.find((d) => d.id === L.ref) || L.displays[0];
    }
    // Part of the reference frame shown on display d (cropped to its aspect, centred).
    function coverMap(d, ref) {
      const ar = d.w / d.h / (ref.w / ref.h);
      const sx = ar > 1 ? 1 : ar;
      const sy = ar > 1 ? 1 / ar : 1;
      return [(1 - sx) / 2, (1 - sy) / 2, sx, sy];
    }
    // global DIP -> reference-frame DIP (null when the point is on no display)
    function toFrame(gx, gy, ref) {
      if (!ref) return [gx, gy];
      for (const d of st.layout.displays) {
        if (gx < d.x || gx >= d.x + d.w || gy < d.y || gy >= d.y + d.h) continue;
        const m = coverMap(d, ref);
        return [(m[0] + ((gx - d.x) / d.w) * m[2]) * ref.w, (m[1] + ((gy - d.y) / d.h) * m[3]) * ref.h];
      }
      return null;
    }
    function blitMirror(ref) {
      const views = viewList();
      if (!views) return;
      gl.useProgram(blitP.p);
      gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.uniform1i(blitP.u('uTex'), st.mirror.attach(0));
      for (const v of views) {
        gl.viewport(v.sx, v.sy, v.sw, v.sh);
        const m = coverMap(v.d, ref);
        gl.uniform4f(blitP.u('uMap'), m[0], m[1], m[2], m[3]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    // ---------------------------------------------------------------- live glass feed
    // A small copy of every new frame, read back asynchronously (no GPU stall) and handed
    // to opts.onFeed: the Liquid Glass surfaces refract it in real time.
    const FEED_DIV = 3; // DIP per feed pixel
    const feed = { fb: null, half: null, pbo: null, bytes: 0, fence: null, info: null, last: 0 };
    function feedCapture(ref) {
      const t = performance.now();
      if (!opts.onFeed || feed.fence || t - feed.last < 32) return;
      feed.last = t;
      const L = layout();
      const dipW = ref ? ref.w : L.total[0];
      const dipH = ref ? ref.h : L.total[1];
      const fw = Math.max(1, Math.round(dipW / FEED_DIV));
      const fh = Math.max(1, Math.round(dipH / FEED_DIV));
      if (!feed.fb || feed.fb.w !== fw || feed.fb.h !== fh) {
        [feed.fb, feed.half].forEach((b) => b && b.dispose());
        const o8 = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
        feed.fb = G.fbo(fw, fh, o8);
        feed.half = G.fbo(fw * 2, fh * 2, o8);
      }
      const src = st.mirror;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src ? src.fb : null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, feed.half.fb);
      gl.blitFramebuffer(0, 0, src ? src.w : canvas.width, src ? src.h : canvas.height, 0, 0, feed.half.w, feed.half.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, feed.half.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, feed.fb.fb);
      gl.blitFramebuffer(0, 0, feed.half.w, feed.half.h, 0, 0, fw, fh, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, feed.fb.fb);
      if (!feed.pbo) feed.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, feed.pbo);
      const bytes = fw * fh * 4;
      if (feed.bytes !== bytes) {
        gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
        feed.bytes = bytes;
      }
      gl.readPixels(0, 0, fw, fh, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      feed.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      feed.info = { w: fw, h: fh, dipW, dipH };
      gl.flush();
    }
    function feedCollect() {
      if (!feed.fence) return;
      const r = gl.clientWaitSync(feed.fence, 0, 0);
      if (r === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(feed.fence);
      feed.fence = null;
      if (r === gl.WAIT_FAILED) return;
      const data = new Uint8Array(feed.bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, feed.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      opts.onFeed({ ...feed.info, data });
    }

    function layout() {
      if (st.layout && !st.preview) return st.layout;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      return { offset: [0, 0], total: [w, h], focus: [w / 2, h / 2], origin: null };
    }

    function resize() {
      const def = scenes[st.sceneId];
      const dpr = window.devicePixelRatio || 1;
      const q = (st.preview ? 1 : QUALITY[st.quality] || 0.75) * (def && def.resolution ? def.resolution : 1);
      const w = Math.max(2, Math.round((canvas.clientWidth || 2) * dpr * q));
      const h = Math.max(2, Math.round((canvas.clientHeight || 2) * dpr * q));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ref = mirrorRef();
      const k = canvas.width / (canvas.clientWidth || 1);
      const fw = ref ? Math.max(2, Math.round(ref.w * k)) : canvas.width;
      const fh = ref ? Math.max(2, Math.round(ref.h * k)) : canvas.height;
      if (ref && (!st.mirror || st.mirror.w !== fw || st.mirror.h !== fh)) {
        if (st.mirror) st.mirror.dispose();
        st.mirror = G.fbo(fw, fh, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
      } else if (!ref && st.mirror) {
        st.mirror.dispose();
        st.mirror = null;
      }
      if (fw !== st.fw || fh !== st.fh) {
        st.fw = fw;
        st.fh = fh;
        if (st.inst && st.inst.resize) st.inst.resize(fw, fh);
      }
    }

    const now = () => (Date.now() % 1e7) / 1000;

    function frameState(dt) {
      const ref = mirrorRef();
      const L = ref ? { offset: [0, 0], total: [ref.w, ref.h], focus: [ref.w / 2, ref.h / 2] } : layout();
      const W = st.fw || canvas.width;
      const H = st.fh || canvas.height;
      const scale = ref ? W / ref.w : canvas.width / (canvas.clientWidth || 1);
      const m = st.mouse;
      const t = now();
      const mp = m.gx > -1e3 ? toFrame(m.gx, m.gy, ref) : null;
      const gx = mp ? mp[0] : -1e4;
      const gy = mp ? mp[1] : -1e4;
      // pointer → this frame (pixels, bottom-up)
      const lx = (gx - L.offset[0]) * scale;
      const ly = (gy - L.offset[1]) * scale;
      const inside = lx >= 0 && ly >= 0 && lx < W && ly < H;
      // smoothed look vector for parallax cameras
      const tx = Math.max(-1, Math.min(1, (gx - L.focus[0]) / (L.total[1] || 1)));
      const ty = Math.max(-1, Math.min(1, (gy - L.focus[1]) / (L.total[1] || 1)));
      const k = 1 - Math.exp(-dt * 2.5);
      if (gx > -1e3) {
        st.look[0] += (tx - st.look[0]) * k;
        st.look[1] += (ty - st.look[1]) * k;
      }
      m.speed *= Math.exp(-dt * 4);
      return {
        gl,
        G,
        dt,
        time: t,
        width: W,
        height: H,
        scale,
        offset: L.offset,
        total: L.total,
        focus: L.focus,
        // displays in frame space when the scene spans them (for keeping things off the bezels)
        displays: !ref && !st.preview && st.layout ? st.layout.displays : null,
        preview: st.preview,
        mouse: {
          gx,
          gy,
          x: lx,
          y: ly,
          vx: m.vx * scale,
          vy: m.vy * scale,
          inside,
          speed: m.speed,
          active: mp && performance.now() < m.activeUntil ? 1 : 0,
        },
        look: st.look,
        clicks: st.clicks
          .map((c) => toFrame(c.gx, c.gy, ref))
          .filter(Boolean)
          .map(([cx, cy]) => ({ gx: cx, gy: cy, x: (cx - L.offset[0]) * scale, y: (cy - L.offset[1]) * scale })),
        click: (() => {
          const c = st.click.gx > -1e3 && toFrame(st.click.gx, st.click.gy, ref);
          return { gx: c ? c[0] : -1e4, gy: c ? c[1] : -1e4, age: Math.min(1000, t - st.click.at) };
        })(),
        audio: st.audio,
      };
    }

    function loop(ts) {
      st.raf = requestAnimationFrame(loop);
      feedCollect();
      // paused: still draw one frame after any change, so nothing is ever left black
      if (!st.inst || (st.paused && !st.needFrame)) return;
      const def = scenes[st.sceneId];
      const fps = Math.min(st.fps, (def && def.maxFps) || 1000);
      const minDt = fps >= 120 ? 0 : 1000 / fps - 1.5;
      if (ts - st.last < minDt) return;
      const dt = Math.min(0.05, Math.max(0.001, (ts - st.last) / 1000));
      st.last = ts;
      resize();
      st.needFrame = false;
      st.drew = false;
      try {
        st.inst.render(frameState(dt));
        if (st.drew) {
          const ref = mirrorRef();
          if (st.mirror && ref) blitMirror(ref);
          feedCapture(ref);
        }
      } catch (e) {
        console.error(e);
        st.paused = true;
      }
      st.clicks.length = 0;
      st.audio.beat *= Math.exp(-dt * 6);
    }

    function setScene(id) {
      if (id === st.sceneId && st.inst) return;
      if (st.inst && st.inst.dispose) st.inst.dispose();
      st.inst = null;
      st.sceneId = scenes[id] ? id : order[0];
      resize();
      try {
        st.inst = scenes[st.sceneId].create(G, { width: st.fw || canvas.width, height: st.fh || canvas.height, preview: st.preview });
      } catch (e) {
        console.error('scene failed', st.sceneId, e);
      }
    }

    const api = {
      configure(c) {
        st.needFrame = true;
        if (c.quality) st.quality = c.quality;
        if (c.fps) st.fps = c.fps;
        if (c.layout) {
          st.layout = c.layout;
          if (st.inst && st.inst.invalidate) st.inst.invalidate();
        }
        if (c.span !== undefined && st.span !== !!c.span) {
          st.span = !!c.span;
          if (st.inst && st.inst.invalidate) st.inst.invalidate();
        }
        resize();
        if (c.scene) setScene(c.scene);
      },
      // Pointer in screen DIP (main process) — converted to global bottom-up space.
      setScreenMouse(x, y) {
        const L = layout();
        if (!L.origin) return;
        api.setMouse(x - L.origin[0], L.origin[1] - y);
      },
      setMouse(gx, gy) {
        const m = st.mouse;
        const t = performance.now();
        if (m.pgx > -1e3) {
          const dt = Math.max(1, t - (m.pt || t - 16)) / 1000;
          m.vx = (gx - m.pgx) / dt;
          m.vy = (gy - m.pgy) / dt;
          m.speed = Math.max(m.speed, Math.hypot(m.vx, m.vy));
        }
        m.pgx = gx;
        m.pgy = gy;
        m.pt = t;
        m.gx = gx;
        m.gy = gy;
        m.activeUntil = t + 2500;
      },
      screenClick(x, y) {
        const L = layout();
        if (!L.origin) return;
        api.click(x - L.origin[0], L.origin[1] - y);
      },
      click(gx, gy) {
        st.clicks.push({ gx, gy });
        st.click = { gx, gy, at: now() };
      },
      setAudio(a) {
        st.audio.bass = a.bass;
        st.audio.mid = a.mid;
        st.audio.treble = a.treble;
        st.audio.level = a.level;
        if (a.beat) st.audio.beat = 1;
      },
      setPaused(p) {
        if (!!p !== st.paused) st.needFrame = true;
        st.paused = !!p;
        st.last = performance.now();
        if (!p && st.inst && st.inst.invalidate) st.inst.invalidate();
      },
      start() {
        if (!st.raf) st.raf = requestAnimationFrame(loop);
      },
      dispose() {
        cancelAnimationFrame(st.raf);
        st.raf = 0;
        if (st.inst && st.inst.dispose) st.inst.dispose();
        st.inst = null;
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      },
      get scene() {
        return st.sceneId;
      },
    };
    return api;
  }

  function shader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      throw new Error(`shader compile failed: ${log}`);
    }
    return s;
  }

  window.WallEngine = {
    register,
    create,
    list: () =>
      [...order]
        .sort((a, b) => (scenes[a].order ?? 50) - (scenes[b].order ?? 50))
        .map((id) => ({ id, name: scenes[id].name, desc: scenes[id].desc })),
  };
})();
