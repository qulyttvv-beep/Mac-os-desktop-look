// Flux — generative silk. A couple of hundred thousand particles ride a flow field and
// leave glowing trails coloured by the direction they travel. Every half a minute or so
// a new piece is generated at random — the kind of flow (curl-noise currents, a galaxy
// spiral, ribbons or petals), mirrored or not, wandering whirlpools, a vivid palette,
// speed, trail length, grain — and the old one melts into it. It reacts to everything:
// the pointer stirs the flow and makes it glow, a click sends a shockwave and leaves a
// whirlpool, the beat fires bursts, shifts the colours and pushes everything along, and
// now and then it sets off a burst of its own.
WallEngine.register({
  id: 'flux',
  name: 'Flux',
  desc: 'Generative particle silk — a new random piece every half minute',
  order: 3,
  span: true, // one flowing picture across all displays
  resolution: 0.75,
  create(G, info) {
    const { gl } = G;

    const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}`;

    // ---------------------------------------------------------------- flow field (low-res grid)
    // Thirteen kinds of flow, each optionally mirrored (left/right — which on two monitors
    // makes them mirror each other — or four ways):
    //   0 curl-noise currents   1 galaxies          2 ribbons        3 petals
    //   4 magnetic field lines  5 circuit traces    6 starbursts     7 falling curtains
    //   8 glowing shapes        9 ring bands       10 infinity      11 zigzag lightning
    //  12 pulsing rings
    // Galaxies, petals, shapes, rings and pulses are built around EACH monitor's centre;
    // poles, burst centres and the infinity loops sit on the monitors too, so every
    // screen has its own centrepiece and the streams run across the bezels between them.
    // The four slots V[] are wandering whirlpools, poles (4), burst centres (6) or loops (10).
    const fieldP = G.program(`
in vec2 vUv;
uniform float uAspect, uMix;
uniform vec4 uFA, uFB;     // frequency, time scale, detail octave, drift angle
uniform vec4 uGA, uGB;     // drift amount, time offset, whirlpool pull, -
uniform vec4 uMA, uMB;     // kind, mirror, noise mix, direction
uniform vec4 uVA[4];
uniform vec4 uVB[4];
uniform vec4 uSA, uSB;     // shapes on displays 0, 1, 2 and their size
uniform vec4 uDC[3];       // displays in frame units: centre x, y, half width, half height
uniform float uDN;
${NOISE}
// which display a point belongs to (index), and its rectangle
int dispAt(vec2 p, out vec4 D) {
  int best = 0;
  float bd = 1e9;
  D = uDC[0];
  for (int i = 0; i < 3; i++) {
    if (float(i) >= uDN) break;
    vec2 e = max(abs(p - uDC[i].xy) - uDC[i].zw, 0.0);
    float dd = dot(e, e) + 1e-4 * length(p - uDC[i].xy);
    if (dd < bd) { bd = dd; best = i; D = uDC[i]; }
  }
  return best;
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  vec2 m = 0.5 * vec2(max(p.x + p.y, 0.0));
  return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(p - m, p - m))) * sign(p.x - p.y);
}
float sdHex(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float shapeSDF(vec2 u, float id, float s) {
  if (id < 0.5) return length(u) - s;
  if (id < 1.5) return sdStar5(u, s * 1.15, 0.45);
  if (id < 2.5) return sdHeart(u / (s * 1.3) + vec2(0.0, 0.55)) * s * 1.3;
  if (id < 3.5) return sdHex(u, s * 0.9);
  vec2 q = abs(u) - vec2(s * 0.9) + s * 0.3;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - s * 0.3;
}
vec2 curl(vec2 p, vec4 F, vec4 Gp, float ph) {
  const float e = 0.02;
  vec3 q = vec3(p * F.x + ph, Gp.y);
  vec2 v = vec2(snoise(q + vec3(0.0, e, 0.0)) - snoise(q - vec3(0.0, e, 0.0)),
              -(snoise(q + vec3(e, 0.0, 0.0)) - snoise(q - vec3(e, 0.0, 0.0)))) / (2.0 * e);
  if (F.z > 0.0) {
    vec3 r = vec3(p * F.x * 2.3 + 17.0 + ph, Gp.y * 1.7);
    v += vec2(snoise(r + vec3(0.0, e, 0.0)) - snoise(r - vec3(0.0, e, 0.0)),
            -(snoise(r + vec3(e, 0.0, 0.0)) - snoise(r - vec3(e, 0.0, 0.0)))) / (2.0 * e) * F.z;
  }
  return v * 0.35;
}
vec2 field(vec2 p, vec4 F, vec4 Gp, vec4 M, vec4 V[4], vec4 S, float ph) {
  vec2 c = vec2(uAspect * 0.5, 0.5);
  bool fx = M.y > 0.5 && p.x > c.x;
  bool fy = M.y > 1.5 && p.y > c.y;
  vec2 q = vec2(fx ? 2.0 * c.x - p.x : p.x, fy ? 1.0 - p.y : p.y);
  vec2 n = curl(q, F, Gp, ph);
  vec4 D;
  int di = dispAt(q, D);           // the monitor this point is on: its own centrepiece
  vec2 d = q - D.xy;
  float r = length(d) + 0.04;
  vec2 v;
  int kind = int(M.x + 0.5);
  if (kind == 1) {
    v = (vec2(-d.y, d.x) * 0.6 * M.w - d * 0.2) / r + n * M.z;
  } else if (kind == 2) {
    float w = sin(q.y * F.x * 5.0 + Gp.y * 1.5 + snoise(vec3(q * F.x * 0.7, Gp.y * 0.5)) * 2.5);
    v = vec2(M.w, w * 0.9) * 0.55 + n * M.z;
  } else if (kind == 3) {
    float a = atan(d.y, d.x);
    float k = sin(a * floor(3.0 + F.x * 2.0) + Gp.y * 2.0);
    v = (vec2(-d.y, d.x) * k * M.w + d * cos(a * 5.0 - Gp.y) * 0.3) / r * 0.6 + n * M.z;
  } else if (kind == 4) {
    // field lines between + and - poles, like iron filings
    vec2 e = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      if (V[i].w <= 0.0) continue;
      vec2 g = q - V[i].xy;
      float l2 = dot(g, g) + 0.003;
      e += V[i].z * g / (l2 * sqrt(l2));
    }
    v = e / (length(e) + 1.5) * 1.3 + n * M.z * 0.25;
  } else if (kind == 5) {
    // circuit board: every cell sends its traffic one straight way, re-routed now and then
    vec2 cell = floor(q * F.x * 4.0);
    float h = hash12(cell + floor(Gp.y * 0.6) * 7.31);
    vec2 dir = h < 0.25 ? vec2(1.0, 0.0) : h < 0.5 ? vec2(-1.0, 0.0) : h < 0.75 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    v = dir * 0.75 + n * 0.08;
  } else if (kind == 6) {
    // starbursts: streaks flying out of a few centres
    vec2 e = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      if (V[i].w <= 0.0) continue;
      vec2 g = q - V[i].xy;
      float l = length(g) + 0.02;
      e += g / l / (l + 0.15);
    }
    v = normalize(e + 1e-5) * 0.8 + n * M.z * 0.3;
  } else if (kind == 7) {
    // curtains: falling (or rising) streams that sway like an aurora
    v = vec2(sin(q.y * 4.0 * F.x + Gp.y * 2.0 + q.x * 1.3) * 0.3 + n.x * 0.6, -0.75 * M.w);
    v.x -= sin(q.x * 9.0 * F.x + Gp.y * 0.7) * 0.35;   // gather into bands with dark gaps
  } else if (kind == 8) {
    // glowing outlines: particles are drawn onto a shape on each monitor and run along it
    float sid = di == 0 ? S.x : di == 1 ? S.y : S.z;
    vec2 u = d / D.w;
    const float e = 0.01;
    float s0 = shapeSDF(u, sid, S.w);
    vec2 g = vec2(shapeSDF(u + vec2(e, 0.0), sid, S.w) - shapeSDF(u - vec2(e, 0.0), sid, S.w),
                  shapeSDF(u + vec2(0.0, e), sid, S.w) - shapeSDF(u - vec2(0.0, e), sid, S.w));
    g /= max(length(g), 1e-4);
    v = -g * clamp(s0 * 6.0, -1.0, 1.0) * 0.75 + vec2(-g.y, g.x) * 0.9 * M.w + n * M.z * 0.35;
  } else if (kind == 9) {
    // ring bands turning alternately one way and the other around each monitor's centre
    vec2 u = d / D.w;
    float rr = length(u) + 1e-3;
    float band = clamp(sin(rr * F.x * 9.0 - Gp.y * 0.5) * 3.0, -1.0, 1.0);
    v = vec2(-u.y, u.x) / rr * band * 0.85 * M.w + u / rr * cos(rr * F.x * 9.0 - Gp.y * 0.5) * 0.12 + n * M.z * 0.3;
  } else if (kind == 10) {
    // infinity: two loops turning opposite ways, one per monitor, crossing in between
    vec2 e2 = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      if (V[i].w <= 0.0) continue;
      vec2 g = q - V[i].xy;
      float l = length(g) + 0.05;
      e2 += vec2(-g.y, g.x) / l * V[i].z * exp(-l * l / (V[i].w * V[i].w));
    }
    v = e2 * 1.15 + n * M.z * 0.3;
  } else if (kind == 11) {
    // zigzag lightning: streams snapping up and down as they cross
    float z = sign(fract(q.x * F.x * 2.5 + 0.25 * sin(Gp.y)) - 0.5);
    v = vec2(0.55 * M.w, 0.85 * z) + n * 0.12;
  } else if (kind == 12) {
    // pulsing rings: everything breathes in and out around each monitor's centre
    vec2 u = d / D.w;
    float rr = length(u) + 1e-3;
    v = u / rr * sin(rr * F.x * 8.0 - Gp.y * 6.0) * 0.9 + vec2(-u.y, u.x) / rr * 0.15 * M.w + n * M.z * 0.2;
  } else {
    v = n;
  }
  for (int i = 0; i < 4; i++) {
    if (V[i].w <= 0.0 || kind == 4 || kind == 6 || kind == 10) continue;
    vec2 e = q - V[i].xy;
    float g = exp(-dot(e, e) / (V[i].w * V[i].w)) / (V[i].w * V[i].w);
    v += (vec2(-e.y, e.x) * V[i].z - e * Gp.z * abs(V[i].z)) * g;
  }
  v += vec2(cos(F.w), sin(F.w)) * Gp.x;
  if (fx) v.x = -v.x;
  if (fy) v.y = -v.y;
  return v;
}
void main() {
  vec2 p = vUv * vec2(uAspect, 1.0);
  vec2 v = field(p, uFA, uGA, uMA, uVA, uSA, 0.0);
  if (uMix > 0.0) v = mix(v, field(p, uFB, uGB, uMB, uVB, uSB, 31.7), uMix);
  outColor = vec4(v, 0.0, 1.0);
}`);

    // ---------------------------------------------------------------- particles (one texel each)
    const stepP = G.program(`
in vec2 vUv;
uniform sampler2D uState, uField;
uniform float uDt, uAspect, uSpeed;
uniform vec4 uPtr;     // pointer x, y (frame units), velocity x, y
uniform float uPtrOn;
uniform vec4 uB0, uB1; // shockwaves: x, y, age (s), strength
uniform vec4 uCV;      // whirlpool left by a click: x, y, strength, radius
uniform float uFold;   // mirrored piece: 1 left/right, 2 four ways
vec2 shock(vec2 p, vec4 B) {
  if (B.z > 3.0) return vec2(0.0);
  vec2 d = p - B.xy;
  float r = length(d) + 1e-4;
  float ring = exp(-pow((r - B.z * 0.38) * 8.0, 2.0));
  return d / r * ring * B.w * exp(-B.z * 1.1);
}
void main() {
  vec4 s = texelFetch(uState, ivec2(gl_FragCoord.xy), 0);
  vec2 p = s.xy;
  float seed = floor(s.w);
  float life = fract(s.w);
  vec2 v = texture(uField, p / vec2(uAspect, 1.0)).xy;
  if (uPtrOn > 0.0) {                              // stirring: drag the flow along with the pointer
    vec2 d = p - uPtr.xy;
    float k = exp(-dot(d, d) / 0.012);
    v += uPtr.zw * k * 14.0 + vec2(-d.y, d.x) * k * 9.0;
  }
  v += shock(p, uB0) + shock(p, uB1);
  if (uCV.z != 0.0) {
    vec2 e = p - uCV.xy;
    v += vec2(-e.y, e.x) * uCV.z * exp(-dot(e, e) / (uCV.w * uCV.w)) / (uCV.w * uCV.w);
  }
  vec2 p0 = p;
  p += v * uSpeed * uDt;
  // a mirrored flow runs into its mirror line from both sides: let particles end there
  // instead of piling up into a hard bright seam
  vec2 c = vec2(uAspect * 0.5, 0.5);
  if (uFold > 0.5 && (p0.x - c.x) * (p.x - c.x) <= 0.0) life = 1.0;
  if (uFold > 1.5 && (p0.y - c.y) * (p.y - c.y) <= 0.0) life = 1.0;
  life += uDt / (2.5 + 7.5 * hash12(vec2(seed, 7.13)));
  float ang = atan(v.y, v.x);
  if (life >= 1.0 || p.x < -0.03 || p.y < -0.03 || p.x > uAspect + 0.03 || p.y > 1.03) {
    vec2 r = hash22(gl_FragCoord.xy * 1.37 + fract(uTime * 0.731) * 977.0 + seed);
    p = r * vec2(uAspect, 1.0);
    life = 0.0;
    seed = floor(hash12(gl_FragCoord.yx * 0.73 + fract(uTime * 0.37) * 541.0) * 1023.0);
  }
  outColor = vec4(p, ang, seed + min(life, 0.999));
}`);

    // ---------------------------------------------------------------- trails
    const fadeP = G.program(`
in vec2 vUv;
uniform sampler2D uPrev;
uniform float uFade;
void main() { outColor = vec4(max(texture(uPrev, vUv).rgb * uFade - 0.0006, 0.0), 0.0); }`);

    // points: own shaders (no vertex buffer — each vertex fetches its particle)
    const pointVS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform int uW;
uniform float uAspect, uSize, uInt, uHueDir, uHue, uPalMix, uSparkle;
uniform vec3 uPA[4];
uniform vec3 uPB[4];
uniform vec3 uPtr;     // pointer x, y, on
uniform vec4 uBz;      // bezels between monitors (x, x), colour shift per monitor
out vec3 vCol;
vec3 pal(float t, bool b) {
  t = fract(t) * 4.0;
  int i = int(t);
  float f = smoothstep(0.0, 1.0, fract(t));
  int k = (i + 1) % 4;
  return b ? mix(uPB[i], uPB[k], f) : mix(uPA[i], uPA[k], f);
}
float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  ivec2 tc = ivec2(gl_VertexID % uW, gl_VertexID / uW);
  vec4 s = texelFetch(uState, tc, 0);
  float life = fract(s.w);
  float seed = floor(s.w) / 1024.0;
  gl_Position = vec4(s.x / uAspect * 2.0 - 1.0, s.y * 2.0 - 1.0, 0.0, 1.0);
  float glow = uPtr.z * exp(-dot(s.xy - uPtr.xy, s.xy - uPtr.xy) / 0.02);
  gl_PointSize = uSize * (1.0 + uSparkle * step(0.82, h11(seed * 97.0 + float(gl_VertexID))) + glow * 0.6);
  float mon = (uBz.x > 0.0 ? smoothstep(uBz.x - 0.07, uBz.x + 0.07, s.x) : 0.0) + (uBz.y > 0.0 ? smoothstep(uBz.y - 0.07, uBz.y + 0.07, s.x) : 0.0);
  float t = seed * 0.4 + s.z / 6.2831853 * uHueDir + uHue + glow * 0.18 + mon * uBz.w;
  vec3 c = mix(pal(t, false), pal(t, true), uPalMix);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, 1.3), 0.0);                       // extra vivid
  vCol = c * uInt * (1.0 + glow * 2.5) * smoothstep(0.0, 0.12, life) * smoothstep(1.0, 0.7, life);
}`;
    const pointFS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 o;
void main() { o = vec4(vCol, 0.0); }`;
    const pointP = (() => {
      const mk = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('flux points: ' + gl.getShaderInfoLog(sh));
        return sh;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, pointVS));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, pointFS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const locs = {};
      return { p, u: (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))) };
    })();
    const emptyVao = gl.createVertexArray();

    const post = WallPost.create(G, { dof: false, external: true, threshold: [0.5, 2.0], bloom: 0.55, ca: 0.0014, exposure: 1.1, vignette: 0.45, warm: 0 });
    post.resize(info.width, info.height);

    // ---------------------------------------------------------------- buffers
    const PW = 512;
    let PH = 0;
    let state = null;
    let field = null;
    let trails = null;
    let aspect = 1;
    let key = '';

    function alloc(f) {
      aspect = f.total[0] / f.total[1];
      const area = f.width * f.height;
      const count = info.preview ? 9216 : Math.max(32768, Math.min(196608, Math.round(area / 22)));
      PH = Math.ceil(count / PW);
      const init = new Float32Array(PW * PH * 4);
      for (let i = 0; i < PW * PH; i++) {
        init[i * 4] = Math.random() * aspect;
        init[i * 4 + 1] = Math.random();
        init[i * 4 + 2] = 0;
        init[i * 4 + 3] = Math.floor(Math.random() * 1023) + Math.random() * 0.99;
      }
      if (state) state.dispose();
      const o32 = { internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: gl.NEAREST };
      state = G.double(PW, PH, o32);
      for (const t of [state.read, state.write]) {
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PW, PH, 0, gl.RGBA, gl.FLOAT, init);
      }
      if (field) field.dispose();
      const fh = info.preview ? 48 : 128;
      field = G.fbo(Math.max(8, Math.round(fh * aspect)), fh, { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT });
      allocTrails(f.width, f.height);
    }
    function allocTrails(w, h) {
      if (trails) trails.dispose();
      trails = G.double(w, h);
    }

    // ---------------------------------------------------------------- random pieces
    const PALETTES = [
      ['#ff2d75', '#ff9f1c', '#ffe94d', '#2ec4ff'],
      ['#00ffd0', '#00a8ff', '#a64dff', '#ff4dc4'],
      ['#ff1f8f', '#9d00ff', '#4d4dff', '#00e5ff'],
      ['#ffd23f', '#ff3864', '#00f5a0', '#2d7dff'],
      ['#ff6b00', '#ffb700', '#fff04d', '#ff2a00'],
      ['#5effff', '#00b4ff', '#7a5cff', '#ff70f0'],
      ['#ff4d6d', '#ffd166', '#5dff8f', '#4dc9ff'],
      ['#39ff14', '#00ffd5', '#0099ff', '#c300ff'],
      ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec'],
      ['#ff00c8', '#ff7a00', '#00ff9d', '#00b3ff'],
      ['#fffb00', '#ff3df2', '#3dfff5', '#ff7b3d'],
      ['#ffffff', '#7df9ff', '#ff6ec7', '#ffe66d'],
    ];
    // Two-colour looks: the flow shows one colour going one way and the other coming back.
    const DUOS = [
      ['#ff4fd8', '#3d7bff'], // pink & blue
      ['#ff2e93', '#00e5ff'], // hot pink & cyan
      ['#ff8a00', '#00d1c1'], // orange & teal
      ['#9d4dff', '#ffc93c'], // purple & gold
      ['#ff2a3d', '#f4f6ff'], // red & white
      ['#b6ff00', '#7a2cff'], // lime & violet
      ['#ff6f61', '#5dffc3'], // coral & mint
      ['#ff00a8', '#ffe600'], // magenta & yellow
      ['#2f6bff', '#eaf2ff'], // blue & white
      ['#00ffe1', '#b400ff'], // aqua & purple
      ['#ff5e00', '#ff00cc'], // orange & magenta
    ];
    const lin = (hex) => [1, 3, 5].map((i) => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
    const duo = (a, b) => [a, a.map((v) => Math.min(1, v * 1.35 + 0.02)), b, b.map((v) => Math.min(1, v * 1.35 + 0.02))];
    const hsl = (h) => {
      const k = (n) => (n + h * 12) % 12;
      const f = (n) => 0.55 - 0.45 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
      return [f(0), f(8), f(4)].map((v) => Math.pow(v, 2.2));
    };
    // a random neon palette: four hues spread around the colour wheel, fully saturated
    function neon() {
      const h0 = Math.random();
      const step = 0.12 + Math.random() * 0.2;
      return [0, 1, 2, 3].map((i) => {
        const h = (h0 + i * step) % 1;
        const k = (n) => (n + h * 12) % 12;
        const f = (n) => 0.55 - 0.45 * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
        return [f(0), f(8), f(4)].map((v) => Math.pow(v, 2.2));
      });
    }
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pickW = (w) => {
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return i;
      return 0;
    };
    // the monitors, in frame units (one "monitor" — the whole picture — in previews)
    let disps = [];
    function readDisplays(f) {
      const H = f.total[1];
      const list = (f.displays || []).map((d) => ({ x: (d.x + d.w / 2) / H, y: (d.y + d.h / 2) / H, hw: d.w / 2 / H, hh: d.h / 2 / H }));
      disps = list.length ? list.sort((a, b) => a.x - b.x).slice(0, 3) : [{ x: aspect / 2, y: 0.5, hw: aspect / 2, hh: 0.5 }];
    }
    const wander = (x, y, a) => ({ x, y, ax: a, ay: a * 0.7, wx: rnd(0.04, 0.12), wy: rnd(0.04, 0.12), ph: rnd(0, 6.3) });
    function makePiece() {
      const kind = window.FLUX_KIND != null ? +window.FLUX_KIND : pickW([0.08, 0.08, 0.07, 0.06, 0.1, 0.07, 0.08, 0.07, 0.11, 0.07, 0.08, 0.06, 0.07]);
      const fold = Math.random() < 0.32 ? (Math.random() < 0.6 ? 1 : 2) : 0;
      const half = fold ? aspect / 2 : aspect;
      const vort = [];
      const nv = Math.floor(rnd(0, 4.99));
      for (let i = 0; i < 4; i++) {
        vort.push(
          i < nv
            ? { x: rnd(0.15, half - 0.1), y: rnd(0.15, 0.85), ax: rnd(0.05, 0.35), ay: rnd(0.04, 0.25), wx: rnd(0.05, 0.25), wy: rnd(0.05, 0.25), ph: rnd(0, 6.3), s: (Math.random() < 0.5 ? -1 : 1) * rnd(0.012, 0.04), r: rnd(0.1, 0.32) }
            : null
        );
      }
      const r = Math.random();
      let pal;
      if (r < 0.38) {
        const d = DUOS[Math.floor(Math.random() * DUOS.length)];
        pal = duo(lin(d[0]), lin(d[1]));
      } else if (r < 0.52) {
        const h = Math.random();
        pal = duo(hsl(h), hsl((h + rnd(0.35, 0.65)) % 1)); // a random two-colour pair
      } else if (r < 0.8) pal = PALETTES[Math.floor(Math.random() * PALETTES.length)].map(lin);
      else pal = neon();
      const multi = disps.length > 1;
      if (kind === 4 || kind === 6) {
        // poles / burst centres: one on each monitor (field lines then arc from screen to
        // screen), plus a wandering extra or two
        const n = Math.max(multi ? disps.length : 2, Math.floor(rnd(2, 4.99)));
        for (let i = 0; i < 4; i++) {
          const d = disps[i];
          const base = d && multi ? wander(d.x + rnd(-0.1, 0.1) * d.hw, d.y + rnd(-0.15, 0.15), rnd(0.02, 0.1)) : wander(rnd(0.2, half - 0.15), rnd(0.2, 0.8), rnd(0.03, 0.2));
          vort[i] = i < n ? { ...base, s: kind === 4 ? (i % 2 ? -1 : 1) : 1, r: 1 } : null;
        }
      }
      if (kind === 10) {
        // infinity: a loop on each of the first two monitors (or both halves of one)
        const a = multi ? disps[0] : { x: aspect * 0.3, y: 0.5, hh: 0.4 };
        const b = multi ? disps[1] : { x: aspect * 0.7, y: 0.5, hh: 0.4 };
        const spin = Math.random() < 0.5 ? -1 : 1;
        vort[0] = { ...wander(a.x, a.y, 0.03), s: spin, r: (multi ? a.hh : 0.4) * 1.15 };
        vort[1] = { ...wander(b.x, b.y, 0.03), s: -spin, r: (multi ? b.hh : 0.4) * 1.15 };
        vort[2] = null;
        vort[3] = null;
      }
      // shapes: each monitor its own (or all the same), sized to the screen
      const sh = Math.floor(rnd(0, 4.99));
      const same = Math.random() < 0.35;
      const shapes = [sh, same ? sh : Math.floor(rnd(0, 4.99)), same ? sh : Math.floor(rnd(0, 4.99)), rnd(0.5, 0.72)];
      if (Math.random() < 0.5) pal.reverse();
      return {
        F: [kind === 2 ? rnd(0.35, 1.1) : rnd(0.45, 1.7), rnd(0.03, 0.12), Math.random() < 0.5 ? rnd(0.15, 0.5) : 0, rnd(0, Math.PI * 2)],
        M: [kind, kind === 5 || kind === 10 || (kind === 8 && multi) ? 0 : fold, rnd(0.2, 0.6), Math.random() < 0.5 ? -1 : 1],
        shapes,
        // each monitor wears its own colour of the palette (the other half of a duo)
        mon: Math.random() < 0.65 ? (r < 0.52 ? 0.5 : rnd(0.25, 0.5)) : 0,
        drift: Math.random() < 0.4 ? rnd(0.05, 0.3) : 0,
        pull: Math.random() < 0.4 ? rnd(0.3, 1.2) : 0,
        vort,
        pal,
        speed: rnd(0.12, 0.27),
        fade: rnd(0.93, 0.985),
        size: rnd(1.1, 2.1),
        hueDir: [1, 1, 1, 2][Math.floor(Math.random() * 4)], // whole turns: no colour seam where the angle wraps
        hueSpeed: (Math.random() < 0.5 ? -1 : 1) * rnd(0.002, 0.03),
        bright: rnd(1.0, 1.5),
        t0: 0,
        phase: rnd(0, 100),
      };
    }
    function vortUniforms(P, t, buf) {
      buf.fill(0);
      P.vort.forEach((v, i) => {
        if (v) buf.set([v.x + Math.sin(t * v.wx + v.ph) * v.ax, v.y + Math.cos(t * v.wy + v.ph * 1.3) * v.ay, v.s, v.r], i * 4);
      });
    }
    let A = null;
    let B = null;
    let nextPiece = 0;
    const lerp = (a, b, t) => a + (b - a) * t;

    // ---------------------------------------------------------------- interaction
    const bursts = [
      [0, 0, 99, 0],
      [0, 0, 99, 0],
    ];
    const burstAt = [-99, -99];
    let nb = 0;
    let clickV = [0, 0, 0, 0.18];
    let clickAt = -99;
    let prevBeat = 0;
    let pulse = 0;
    let flash = 0;
    let hue = 0;
    let hueTarget = 0;
    let nextIdleBurst = 0;
    function burst(x, y, strength, t) {
      bursts[nb] = [x, y, 0, strength];
      burstAt[nb] = t;
      nb = (nb + 1) % 2;
    }
    const vortBuf = new Float32Array(16);
    const dispBuf = new Float32Array(12);
    const vortBufB = new Float32Array(16);
    const palA = new Float32Array(12);
    const palB = new Float32Array(12);

    return {
      resize(w, h) {
        post.resize(w, h);
        if (trails) allocTrails(w, h);
      },
      render(f) {
        const k = `${f.total}|${f.width}x${f.height}`;
        if (k !== key) {
          key = k;
          alloc(f);
          readDisplays(f);
          if (!A) {
            A = makePiece();
            nextPiece = f.time + rnd(25, 50);
          }
        }
        const H = f.total[1];
        const dt = Math.min(f.dt, 1 / 30);
        const t = f.time;

        // a new random piece every half a minute or so, melting in over 6 s
        if (!B && (t > nextPiece || t < nextPiece - 200)) {
          B = makePiece();
          B.t0 = t;
        }
        let mix = 0;
        if (B) {
          mix = Math.min(1, Math.max(0, (t - B.t0) / 6));
          if (mix >= 1 || t < B.t0) {
            A = B;
            B = null;
            mix = 0;
            nextPiece = t + rnd(25, 50);
          }
        }
        const sm = mix * mix * (3 - 2 * mix);
        const cur = (name) => (B ? lerp(A[name], B[name], sm) : A[name]);

        // ---- reactions: music, clicks, and random events of its own
        const au = f.audio;
        if (au.beat > prevBeat + 0.5) {
          pulse = 1;
          flash = Math.max(flash, 0.5 + au.bass * 0.5);
          hueTarget += rnd(0.05, 0.16);
          if (Math.random() < 0.6) burst(rnd(0.1, aspect - 0.1), rnd(0.15, 0.85), 1.4 + au.bass * 1.6, t);
        }
        prevBeat = au.beat;
        for (const c of f.clicks) {
          burst(c.gx / H, c.gy / H, 3.2, t);
          clickV = [c.gx / H, c.gy / H, (Math.random() < 0.5 ? -1 : 1) * 0.07, rnd(0.12, 0.22)];
          clickAt = t;
          flash = 1;
          hueTarget += 0.25;
        }
        if (t > nextIdleBurst || t < nextIdleBurst - 60) {
          if (nextIdleBurst) burst(rnd(0.1, aspect - 0.1), rnd(0.15, 0.85), rnd(1.0, 2.2), t);
          nextIdleBurst = t + rnd(3, 8);
        }
        pulse *= Math.exp(-dt * 3.5);
        flash *= Math.exp(-dt * 2.5);
        hueTarget += cur('hueSpeed') * dt;
        hue += (hueTarget - hue) * (1 - Math.exp(-dt * 2));
        bursts.forEach((b, i) => (b[2] = t - burstAt[i]));
        const cvAge = t - clickAt;
        const cvS = cvAge >= 0 && cvAge < 6 ? clickV[2] * Math.exp(-cvAge * 0.6) : 0;

        // ---- field
        vortUniforms(A, t, vortBuf);
        if (B) vortUniforms(B, t, vortBufB);
        G.draw(fieldP, field, (p) => {
          gl.uniform1f(p.u('uAspect'), aspect);
          gl.uniform1f(p.u('uMix'), B ? sm : 0);
          gl.uniform4f(p.u('uFA'), A.F[0], A.F[1], A.F[2], A.F[3]);
          gl.uniform4f(p.u('uGA'), A.drift, t * A.F[1] + A.phase, A.pull, 0);
          gl.uniform4f(p.u('uMA'), A.M[0], A.M[1], A.M[2], A.M[3]);
          gl.uniform4fv(p.u('uVA'), vortBuf);
          gl.uniform4fv(p.u('uSA'), A.shapes);
          dispBuf.fill(0);
          disps.forEach((d, i) => dispBuf.set([d.x, d.y, d.hw, d.hh], i * 4));
          gl.uniform4fv(p.u('uDC'), dispBuf);
          gl.uniform1f(p.u('uDN'), disps.length);
          if (B) {
            gl.uniform4fv(p.u('uSB'), B.shapes);
            gl.uniform4f(p.u('uFB'), B.F[0], B.F[1], B.F[2], B.F[3]);
            gl.uniform4f(p.u('uGB'), B.drift, t * B.F[1] + B.phase, B.pull, 0);
            gl.uniform4f(p.u('uMB'), B.M[0], B.M[1], B.M[2], B.M[3]);
            gl.uniform4fv(p.u('uVB'), vortBufB);
          }
        });

        // ---- particles
        const ptrOn = f.mouse.active && f.mouse.gx > -1e3;
        const px = f.mouse.gx / H;
        const py = f.mouse.gy / H;
        G.draw(stepP, state.write, (p) => {
          G.common(p, f);
          gl.uniform1i(p.u('uState'), state.read.attach(0));
          gl.uniform1i(p.u('uField'), field.attach(1));
          gl.uniform1f(p.u('uDt'), dt);
          gl.uniform1f(p.u('uAspect'), aspect);
          gl.uniform1f(p.u('uSpeed'), cur('speed') * (1 + pulse * 1.4 + au.bass * 0.6 + au.mid * 0.3));
          gl.uniform4f(p.u('uPtr'), px, py, Math.max(-3, Math.min(3, f.mouse.vx / f.scale / H)), Math.max(-3, Math.min(3, f.mouse.vy / f.scale / H)));
          gl.uniform1f(p.u('uPtrOn'), ptrOn ? 1 : 0);
          gl.uniform4fv(p.u('uB0'), bursts[0]);
          gl.uniform4fv(p.u('uB1'), bursts[1]);
          gl.uniform4f(p.u('uCV'), clickV[0], clickV[1], cvS, clickV[3]);
          gl.uniform1f(p.u('uFold'), Math.max(A.M[1], B ? B.M[1] : 0));
        });
        state.swap();

        // ---- trails: fade the old picture, then add every particle on top
        const fade = cur('fade');
        G.draw(fadeP, trails.write, (p) => {
          gl.uniform1i(p.u('uPrev'), trails.read.attach(0));
          gl.uniform1f(p.u('uFade'), fade);
        });
        const density = (PW * PH) / (f.width * f.height);
        const size = cur('size') * Math.max(0.6, f.height / 1080);
        const intensity = ((0.24 * (1 - fade)) / (density * size * size)) * cur('bright') * (1 + au.bass * 0.8 + pulse * 0.6 + flash * 1.2);
        A.pal.forEach((c, i) => palA.set(c, i * 3));
        (B || A).pal.forEach((c, i) => palB.set(c, i * 3));
        gl.useProgram(pointP.p);
        gl.bindVertexArray(emptyVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, trails.write.fb);
        gl.viewport(0, 0, trails.write.w, trails.write.h);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, state.read.tex);
        gl.uniform1i(pointP.u('uState'), 0);
        gl.uniform1i(pointP.u('uW'), PW);
        gl.uniform1f(pointP.u('uAspect'), aspect);
        gl.uniform1f(pointP.u('uSize'), size);
        gl.uniform1f(pointP.u('uInt'), intensity);
        gl.uniform1f(pointP.u('uHueDir'), cur('hueDir'));
        gl.uniform1f(pointP.u('uHue'), hue);
        gl.uniform1f(pointP.u('uPalMix'), B ? sm : 0);
        gl.uniform1f(pointP.u('uSparkle'), au.treble * 1.2 + flash * 0.6);
        gl.uniform3f(pointP.u('uPtr'), px, py, ptrOn ? 1 : 0);
        gl.uniform4f(pointP.u('uBz'), disps[1] ? disps[0].x + disps[0].hw : 0, disps[2] ? disps[1].x + disps[1].hw : 0, 0, cur('mon'));
        gl.uniform3fv(pointP.u('uPA'), palA);
        gl.uniform3fv(pointP.u('uPB'), palB);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, PW * PH);
        gl.disable(gl.BLEND);
        trails.swap();

        post.run(f, trails.read);
      },
      dispose() {
        [state, field, trails].forEach((b) => b && b.dispose());
        post.dispose();
        [fieldP, stepP, fadeP, pointP].forEach((p) => gl.deleteProgram(p.p));
        gl.deleteVertexArray(emptyVao);
      },
    };
  },
});
