// Obsidian — a pool of black liquid in a dark photo studio, shot like a product photo.
//
// The camera looks down onto the surface in perspective. The liquid is a dielectric
// (F0 = 0.04): straight below you it is nearly pure black, toward the back it turns
// into a mirror for the studio lights — a large diffused softbox with seams, two strip
// lights and a small warm practical bulb that sparkles on the ripples.
//
// A GPU wave simulation in surface space takes the pointer (wake) and ambient drips.
// Desktop clicks, the beat of the music and now and then the scene itself drop real
// drops of liquid: they fall (motion-blurred), punch a crater and rings into the
// surface and throw up a Worthington jet whose tip pinches off into a droplet that
// falls back for a second, smaller ring. Surface, drops and jets are one blended
// distance field, so the jet grows out of the liquid, and the surface mirrors them.
// Depth of field, bloom and the film finish come from WallPost.
WallEngine.register({
  id: 'obsidian',
  name: 'Obsidian',
  desc: 'Black liquid in a studio — click or play music for drops',
  order: 1,
  create(G, info) {
    const { gl } = G;
    const MAX_DROPS = 8;
    const PITCH = (52 * Math.PI) / 180; // camera looks down 52°
    const FOVK = 0.74; // tan(half vertical FOV) / 0.5
    const AMP = 0.02; // simulated height → world units
    const GRAV = 3.2; // world units/s²: a slow-motion high-speed camera look

    // ---------------------------------------------------------------- simulation
    const sim = G.program(`
in vec2 vUv;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uAspect;
uniform vec4 uDrops[${MAX_DROPS}];
uniform int uDropCount;
uniform vec4 uDrag;
uniform float uDragAmt, uDragR;
void main() {
  vec2 s = texture(uState, vUv).rg;
  vec2 tx = uTexel;
  float n = texture(uState, vUv + vec2(tx.x, 0.0)).r + texture(uState, vUv - vec2(tx.x, 0.0)).r
          + texture(uState, vUv + vec2(0.0, tx.y)).r + texture(uState, vUv - vec2(0.0, tx.y)).r;
  float dg = texture(uState, vUv + tx).r + texture(uState, vUv - tx).r
           + texture(uState, vUv + vec2(tx.x, -tx.y)).r + texture(uState, vUv + vec2(-tx.x, tx.y)).r;
  // wave equation with the isotropic 9-point Laplacian: rings stay round on the grid
  float h = (s.r / 3.0 + n / 3.0 + dg / 12.0 - s.g) * 0.988;
  vec2 k = vec2(uAspect, 1.0);
  vec2 p = vUv * k;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uDropCount) break;
    vec2 d = p - uDrops[i].xy * k;
    h -= uDrops[i].w * exp(-dot(d, d) / (uDrops[i].z * uDrops[i].z));
  }
  if (uDragAmt > 0.0) {
    vec2 a = uDrag.xy * k, b = uDrag.zw * k, ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-7), 0.0, 1.0);
    vec2 d = p - (a + ab * t);
    h -= uDragAmt * exp(-dot(d, d) / (uDragR * uDragR));
  }
  outColor = vec4(h, s.r, 0.0, 1.0);
}`);

    // ---------------------------------------------------------------- shading (HDR + blur radius)
    const shade = G.program(`
uniform sampler2D uState;
uniform vec2 uSimTexel;
uniform vec4 uRect;        // plane-space rect covered by the simulation: x0, z0, w, d
uniform float uPitch, uFovK, uAmp, uFocusT, uDofK, uDofMax, uAny;
uniform vec4 uSph[6];      // drops in flight: centre, radius
uniform vec4 uSphV[6];     // their velocity (motion-blur streak over one frame)
uniform vec4 uJet[4];      // Worthington jets: x, z, height, radius
uniform vec4 uBound[4];    // bounding spheres around everything above the surface

vec3 camRay(vec2 g) {
  vec2 uv = (g - uFocus) / uTotal.y;
  vec3 fw = vec3(0.0, -sin(uPitch), cos(uPitch));
  vec3 up = vec3(0.0, cos(uPitch), sin(uPitch));
  return normalize(fw + (uv.x * vec3(1.0, 0.0, 0.0) + uv.y * up) * uFovK);
}

// Rounded-rectangle light seen from the origin, in angular (tangent-plane) units.
float rectLight(vec3 r, vec3 dir, vec2 size, float corner, float soft, float seams) {
  float k = dot(r, dir);
  if (k <= 0.0) return 0.0;
  vec3 u = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(u, dir);
  vec2 q = vec2(dot(r, u), dot(r, v)) / k;
  vec2 e = abs(q) - size + corner;
  float d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - corner;
  float m = 1.0 - smoothstep(-soft, soft, d);
  // diffusion fabric: hot centre, darker frame edge, faint seams where the panels meet
  float hot = 1.0 - 0.72 * dot(q / size, q / size);
  float frame = 1.0 - 0.3 * smoothstep(-soft * 3.0 - 0.012, -0.002, d);
  float seam = 1.0 - seams * (1.0 - smoothstep(0.0015, 0.004 + soft * 0.5, abs(abs(q.x) - size.x * 0.34)));
  return m * max(hot, 0.15) * frame * seam;
}

vec3 studio(vec3 r, float rough) {
  float s = 0.006 + rough;
  vec3 col = vec3(0.0016, 0.0017, 0.002) + vec3(0.006, 0.0065, 0.008) * pow(1.0 - abs(r.y), 3.0); // dark cyclorama
  col += vec3(1.0, 0.97, 0.93) * 10.0 * rectLight(r, normalize(vec3(0.0, 0.78, 1.0)), vec2(0.3, 0.11), 0.035, s, 0.2);
  col += vec3(0.86, 0.92, 1.0) * 9.0 * rectLight(r, normalize(vec3(-0.6, 0.5, 0.9)), vec2(0.03, 0.3), 0.02, s, 0.0);
  col += vec3(0.86, 0.92, 1.0) * 9.0 * rectLight(r, normalize(vec3(0.6, 0.5, 0.9)), vec2(0.03, 0.3), 0.02, s, 0.0);
  col += vec3(0.5, 0.52, 0.56) * 0.5 * rectLight(r, vec3(0.0, 1.0, 0.0), vec2(1.2, 1.2), 0.3, 0.6, 0.0);   // ceiling bounce
  // small warm practical bulb far back: the sparkle on every ripple
  vec3 bulb = normalize(vec3(0.62, 0.17, 1.0));
  float c = dot(r, bulb);
  col += vec3(1.0, 0.68, 0.38) * 600.0 * smoothstep(0.999965, 0.999992, c);
  col += vec3(1.0, 0.6, 0.3) * 0.25 * pow(max(c, 0.0), 600.0);
  return col;
}

// The studio seen from anywhere above the pool: below the horizon the pool mirrors it.
vec3 env(vec3 r, float rough) {
  if (r.y >= 0.0) return studio(r, rough);
  float F = 0.04 + 0.96 * pow(1.0 - min(-r.y, 1.0), 5.0);
  return studio(vec3(r.x, -r.y, r.z), rough + 0.01) * F;
}

float heightAt(vec2 P) { return texture(uState, (P - uRect.xy) / uRect.zw).r * uAmp; }

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h) - r; }

float objects(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < 4; i++) {
    vec4 j = uJet[i];
    if (j.z <= 0.0) continue;
    float f = clamp(p.y / j.z, 0.0, 1.0);
    float r = j.w * mix(1.7, 0.75, f) * (1.0 + 0.06 * sin(p.y * 160.0 - uTime * 9.0) * f);  // tapering, capillary ripples
    d = min(d, sdCap(p, vec3(j.x, -0.03, j.y), vec3(j.x, j.z, j.y), r) * 0.8);
  }
  for (int i = 0; i < 6; i++) {
    vec4 s = uSph[i];
    if (s.w <= 0.0) continue;
    d = smin(d, sdCap(p, s.xyz, s.xyz - uSphV[i].xyz * 0.016, s.w), 0.012);
  }
  return d;
}

float sceneSDF(vec3 p) { return smin(p.y - heightAt(p.xz), objects(p), 0.035); }

vec3 sdfNormal(vec3 p) {
  const vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy), sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy), sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)));
}
vec3 objNormal(vec3 p) {
  const vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(objects(p + e.xyy) - objects(p - e.xyy), objects(p + e.yxy) - objects(p - e.yxy), objects(p + e.yyx) - objects(p - e.yyx)));
}

// Open surface: simulated ripples, a slow swell and a faint shimmer from moving air.
vec3 planeNormal(vec2 P, float t) {
  vec2 tx = uSimTexel;
  vec2 suv = (P - uRect.xy) / uRect.zw;
  float hL = texture(uState, suv - vec2(tx.x, 0.0)).r, hR = texture(uState, suv + vec2(tx.x, 0.0)).r;
  float hD = texture(uState, suv - vec2(0.0, tx.y)).r, hU = texture(uState, suv + vec2(0.0, tx.y)).r;
  vec2 grad = vec2((hR - hL) / (2.0 * tx.x * uRect.z), (hU - hD) / (2.0 * tx.y * uRect.w)) * uAmp;
  grad += vec2(sin(P.x * 1.7 + uTime * 0.35), cos(P.y * 1.3 - uTime * 0.27)) * 0.004;
  vec2 q = P * 38.0;
  grad += (vec2(noise(q + vec2(uTime * 0.6, 0.0)), noise(q + vec2(17.0, -uTime * 0.5))) - 0.5) * 0.006 * smoothstep(2.2, 1.05, t);
  return normalize(vec3(-grad.x, 1.0, -grad.y));
}

bool bounds(vec3 ro, vec3 rd, out float t0, out float t1) {
  t0 = 1e9;
  t1 = -1e9;
  for (int i = 0; i < 4; i++) {
    vec4 B = uBound[i];
    if (B.w <= 0.0) continue;
    vec3 oc = ro - B.xyz;
    float b = dot(oc, rd);
    float disc = b * b - (dot(oc, oc) - B.w * B.w);
    if (disc <= 0.0) continue;
    float s = sqrt(disc);
    t0 = min(t0, -b - s);
    t1 = max(t1, -b + s);
  }
  t0 = max(t0, 0.0);
  return t1 > t0;
}

void main() {
  vec3 ro = vec3(0.0, 1.0, 0.0);              // camera 1 unit above the surface
  vec3 rd = camRay(gpos());
  float t = 1.0 / max(-rd.y, 1e-3);
  vec3 pos = ro + rd * t;
  vec3 n = planeNormal(pos.xz, t);
  bool onObj = false;
  float b0, b1;

  // drops and jets: march the blended field, only for rays that pass near them
  if (uAny > 0.5 && bounds(ro, rd, b0, b1)) {
    float tt = b0, tEnd = min(b1, t + 0.15);
    for (int i = 0; i < 72; i++) {
      vec3 q = ro + rd * tt;
      float d = sceneSDF(q);
      if (d < 0.0004 * tt) {
        float w = smoothstep(0.0, 0.035, objects(q));   // 0 on drops and jets, 1 on the open surface
        if (w < 1.0) {
          t = tt;
          pos = q;
          n = normalize(mix(sdfNormal(q), planeNormal(q.xz, t), w));
          onObj = w < 0.5;
        }
        break;
      }
      tt += d * 0.85;
      if (tt > tEnd) break;
    }
  }

  vec3 R = reflect(rd, n);
  if (!onObj) R.y = abs(R.y);
  float cosT = clamp(dot(n, -rd), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  vec3 refl = env(R, onObj ? 0.003 : 0.008 + (t - 1.0) * 0.006);

  // the surface mirrors the drops and jets standing on it (and they block the lights)
  if (!onObj && uAny > 0.5) {
    vec3 o = pos + vec3(0.0, 0.003, 0.0);
    if (bounds(o, R, b0, b1)) {
      float tt = b0;
      for (int i = 0; i < 40; i++) {
        vec3 q = o + R * tt;
        float d = objects(q);
        if (d < 0.0008) {
          vec3 no = objNormal(q);
          float c2 = clamp(dot(no, -R), 0.0, 1.0);
          refl = env(reflect(R, no), 0.004) * (0.04 + 0.96 * pow(1.0 - c2, 5.0));
          break;
        }
        tt += d * 0.9;
        if (tt > b1) break;
      }
    }
  }

  vec3 col = refl * F + vec3(0.0008, 0.0008, 0.001);   // almost no diffuse: jet black
  col += vec3(0.5, 0.14, 0.03) * (uAudio.x * 0.02 + uAudio.w * 0.03) * exp(-t * 0.8);
  // lens blur radius for WallPost: focused across the middle, softer far back than near
  float coc = (t > uFocusT ? t - uFocusT : (uFocusT - t) * 0.6) / t * uDofK;
  outColor = vec4(col, min(coc, uDofMax));
}`);

    const post = WallPost.create(G, { threshold: [1.2, 4.0], bloom: 0.22, ca: 0.0016, vignette: 0.7, warm: 0.02 });
    post.resize(info.width, info.height);

    // ---------------------------------------------------------------- camera & sim space
    let state = null;
    let rect = [0, 0, 1, 1];
    let simAspect = 1;
    let layoutKey = '';

    function camRay(ux, uy) {
      const fw = [0, -Math.sin(PITCH), Math.cos(PITCH)];
      const up = [0, Math.cos(PITCH), Math.sin(PITCH)];
      const d = [ux * FOVK, fw[1] + uy * up[1] * FOVK, fw[2] + uy * up[2] * FOVK];
      const l = Math.hypot(d[0], d[1], d[2]);
      return [d[0] / l, d[1] / l, d[2] / l];
    }
    const toPlane = (ux, uy) => {
      const r = camRay(ux, uy);
      const t = 1 / Math.max(-r[1], 1e-3);
      return [r[0] * t, r[2] * t];
    };
    const planeAt = (f, gx, gy) => toPlane((gx - f.focus[0]) / f.total[1], (gy - f.focus[1]) / f.total[1]);
    const toSim = (x, z) => [(x - rect[0]) / rect[2], (z - rect[1]) / rect[3]];

    function alloc(f) {
      // plane-space bounding box of everything the camera sees across all displays
      const H = f.total[1];
      const pts = [];
      for (const x of [0, f.total[0]]) for (const y of [0, f.total[1]]) pts.push(toPlane((x - f.focus[0]) / H, (y - f.focus[1]) / H));
      const x0 = Math.min(...pts.map((p) => p[0]));
      const x1 = Math.max(...pts.map((p) => p[0]));
      const z0 = Math.min(...pts.map((p) => p[1]));
      const z1 = Math.max(...pts.map((p) => p[1]));
      rect = [x0, z0, x1 - x0, z1 - z0];
      simAspect = rect[2] / rect[3];
      const sh = info.preview ? 120 : 400;
      const sw = Math.max(16, Math.min(2600, Math.round(sh * simAspect)));
      if (state) state.dispose();
      state = G.double(sw, sh, { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT });
    }

    // ---------------------------------------------------------------- falling drops & jets
    const falls = [];
    const sph = new Float32Array(24);
    const sphV = new Float32Array(24);
    const jets = new Float32Array(16);
    const bnd = new Float32Array(16);

    function spawnFall(P, s) {
      if (falls.length < 4) falls.push({ x: P[0], z: P[1], s, t0: -1, hit: false, drop: null, landed: false });
    }

    function updateFalls(f, simDrops) {
      sph.fill(0);
      sphV.fill(0);
      jets.fill(0);
      bnd.fill(0);
      let si = 0;
      let ji = 0;
      const R = 1 / rect[3];
      const addSph = (x, y, z, r, vy) => {
        if (si >= 6) return;
        sph.set([x, y, z, r], si * 4);
        sphV.set([0, vy, 0, 0], si * 4);
        si++;
      };
      for (let k = falls.length - 1; k >= 0; k--) {
        const e = falls[k];
        if (e.t0 < 0) e.t0 = f.time;
        const age = f.time - e.t0;
        if (age < 0 || age > 6) {
          falls.splice(k, 1); // clock wrapped, or something got stuck
          continue;
        }
        const s = e.s;
        const H0 = 0.8;
        const T = Math.sqrt((2 * H0) / GRAV);
        let lo = -0.04;
        let hi = 0.02;
        if (age < T) {
          // falling: enters from the top of the picture, streaked by the shutter
          const r = 0.022 * s;
          const y = H0 - 0.5 * GRAV * age * age + r;
          const v = -GRAV * age;
          addSph(e.x, y, e.z, r, v);
          lo = Math.min(lo, y - r - 0.01);
          hi = y + r - v * 0.016 + 0.01;
        } else {
          if (!e.hit) {
            e.hit = true;
            simDrops.push([...toSim(e.x, e.z), 0.045 * s * R, 1.6 * s]);
          }
          const L = 0.6 * Math.sqrt(s);
          const u = (age - T - 0.06) / L; // the crater collapses, then the jet rises and sinks back
          const Hj = 0.15 * s;
          const PINCH = 0.42;
          if (u > 0 && u < 1) {
            const hgt = Hj * Math.pow(Math.sin(Math.PI * u), 0.8);
            if (ji < 4) jets.set([e.x, e.z, hgt, 0.013 * s], 4 * ji++);
            if (u < PINCH) addSph(e.x, hgt + 0.01 * s, e.z, 0.016 * s, 0);
            hi = Math.max(hi, hgt + 0.04);
          }
          if (u >= PINCH && !e.landed) {
            // the tip pinches off and falls back on its own
            if (!e.drop) e.drop = { y: Hj * Math.pow(Math.sin(Math.PI * PINCH), 0.8) + 0.01 * s, v: 0.35 * s, t: f.time };
            const tau = f.time - e.drop.t;
            const y = e.drop.y + e.drop.v * tau - 0.5 * GRAV * tau * tau;
            const v = e.drop.v - GRAV * tau;
            if (y <= 0.006 || tau < 0) {
              e.landed = true;
              simDrops.push([...toSim(e.x, e.z), 0.022 * s * R, 0.6 * s]);
            } else {
              addSph(e.x, y, e.z, 0.016 * s, v);
              hi = Math.max(hi, y + 0.016 * s + Math.abs(v) * 0.016 + 0.01);
            }
          }
          if (e.landed && u >= 1) {
            falls.splice(k, 1);
            continue;
          }
        }
        if (k < 4) {
          const half = (hi - lo) / 2;
          bnd.set([e.x, (hi + lo) / 2, e.z, Math.hypot(half, 0.065)], k * 4);
        }
      }
      return si + ji > 0 || falls.length > 0;
    }

    // ---------------------------------------------------------------- inputs
    const drops = [];
    const dropBuf = new Float32Array(MAX_DROPS * 4);
    let lastMouse = null;
    let nextAmbient = 0;
    let nextFall = 0;
    let lastBeatFall = -1e9;
    let prevBeat = 0;
    const rnd = Math.random;
    const randomPoint = (f) => planeAt(f, rnd() * f.total[0], (0.2 + rnd() * 0.55) * f.total[1]);

    return {
      resize(w, h) {
        post.resize(w, h);
      },
      render(f) {
        const key = `${f.total}|${f.focus}`;
        if (key !== layoutKey) {
          layoutKey = key;
          alloc(f);
        }
        const R = 1 / rect[3]; // one plane unit in sim-uv (y)

        // ---- inputs
        let drag = null;
        if (f.mouse.active && f.mouse.gx > -1e3) {
          const P = planeAt(f, f.mouse.gx, f.mouse.gy);
          const uv = toSim(P[0], P[1]);
          if (lastMouse) {
            const len = Math.hypot((uv[0] - lastMouse[0]) * simAspect, uv[1] - lastMouse[1]);
            if (len > 0.0004) drag = { a: lastMouse, b: uv, amt: Math.min(0.5, len * 6) };
          }
          lastMouse = uv;
        } else lastMouse = null;
        for (const c of f.clicks) spawnFall(planeAt(f, c.gx, c.gy), 1);
        if (f.audio.beat > prevBeat + 0.5) {
          if (f.time - lastBeatFall > 1.3 || f.time < lastBeatFall) {
            spawnFall(randomPoint(f), 0.6 + f.audio.bass * 0.4);
            lastBeatFall = f.time;
          } else drops.push([0.15 + rnd() * 0.7, 0.2 + rnd() * 0.6, (0.018 + rnd() * 0.012) * R, 0.35 + f.audio.bass * 0.5]);
        }
        prevBeat = f.audio.beat;
        if (f.time > nextAmbient || f.time < nextAmbient - 10) {
          drops.push([rnd(), 0.1 + rnd() * 0.85, (0.01 + rnd() * 0.012) * R, 0.2 + rnd() * 0.3]);
          nextAmbient = f.time + 0.9 + rnd() * 2.4;
        }
        if (f.time > nextFall || f.time < nextFall - 60) {
          if (nextFall) spawnFall(randomPoint(f), 0.75 + rnd() * 0.25);
          nextFall = f.time + 8 + rnd() * 12;
        }
        const any = updateFalls(f, drops);

        // ---- simulate (two substeps; inputs on the first)
        for (let step = 0; step < 2; step++) {
          const batch = step === 0 ? drops.splice(0, MAX_DROPS) : [];
          dropBuf.fill(0);
          batch.forEach((d, i) => dropBuf.set(d, i * 4));
          G.draw(sim, state.write, (p) => {
            gl.uniform1i(p.u('uState'), state.read.attach(0));
            gl.uniform2f(p.u('uTexel'), state.texel[0], state.texel[1]);
            gl.uniform1f(p.u('uAspect'), simAspect);
            gl.uniform4fv(p.u('uDrops'), dropBuf);
            gl.uniform1i(p.u('uDropCount'), batch.length);
            const dr = step === 0 ? drag : null;
            gl.uniform4f(p.u('uDrag'), dr ? dr.a[0] : 0, dr ? dr.a[1] : 0, dr ? dr.b[0] : 0, dr ? dr.b[1] : 0);
            gl.uniform1f(p.u('uDragAmt'), dr ? dr.amt : 0);
            gl.uniform1f(p.u('uDragR'), 0.012 * R);
          });
          state.swap();
        }

        // ---- shade into HDR (alpha = lens blur radius), then depth of field, bloom, finish
        G.draw(shade, post.target, (p) => {
          G.common(p, f);
          gl.uniform1i(p.u('uState'), state.read.attach(0));
          gl.uniform2f(p.u('uSimTexel'), state.texel[0], state.texel[1]);
          gl.uniform4f(p.u('uRect'), rect[0], rect[1], rect[2], rect[3]);
          gl.uniform1f(p.u('uPitch'), PITCH);
          gl.uniform1f(p.u('uFovK'), FOVK);
          gl.uniform1f(p.u('uAmp'), AMP);
          gl.uniform1f(p.u('uFocusT'), 1.3);
          gl.uniform1f(p.u('uDofK'), f.height * 0.018);
          gl.uniform1f(p.u('uDofMax'), f.height * 0.007);
          gl.uniform1f(p.u('uAny'), any ? 1 : 0);
          gl.uniform4fv(p.u('uSph'), sph);
          gl.uniform4fv(p.u('uSphV'), sphV);
          gl.uniform4fv(p.u('uJet'), jets);
          gl.uniform4fv(p.u('uBound'), bnd);
        });
        post.run(f);
      },
      dispose() {
        if (state) state.dispose();
        post.dispose();
        [sim, shade].forEach((p) => gl.deleteProgram(p.p));
      },
    };
  },
});
