// Gummy Bears — translucent jelly bears on a black, glossy studio table, shot macro.
//
// Each bear is a signed-distance model (body, head, ears, snout, arms, legs, moulded
// eyes, nose and mouth) with a faintly uneven, glossy skin. Light refracts into the
// jelly (IOR 1.45), is absorbed with depth (Beer–Lambert: thin parts glow, thick parts
// are deep), refracts out again toward a backlight and casts coloured light pools on the
// table. The key softbox lays a soft pool of light on the table in which every bear
// casts a soft, coloured shadow with a bright focused core. The table mirrors the bears
// (blurrier the further the reflection travels), and a shallow depth of field keeps the
// bears near the middle sharp. They lie in a natural scatter — standing, leaning, on
// their backs, bellies and sides — and wobble like jelly: brush them with the pointer,
// click one to make it hop, the beat makes them all jiggle. More bears appear
// automatically on wider multi-monitor spans.
WallEngine.register({
  id: 'gummy',
  name: 'Gummy Bears',
  desc: 'Wobbly jelly bears you can poke',
  order: 2,
  resolution: 0.62,
  span: true, // one long table across all displays
  create(G, info) {
    const { gl } = G;
    const MAXB = 18;

    const shade = G.program(`
#define MAXB ${MAXB}
uniform int uCount;
uniform vec4 uPos[MAXB];     // xyz, scale
uniform mat3 uRotT[MAXB];    // world → bear-local rotation
uniform vec4 uBound[MAXB];   // bounding sphere
uniform vec4 uJig[MAXB];     // squash, bend x, bend z
uniform vec4 uSig[MAXB];     // absorption rgb, cloudiness
uniform vec4 uOcc0[MAXB];    // shadow proxies: body sphere (world)
uniform vec4 uOcc1[MAXB];    //                 head sphere (world)
uniform vec3 uRo, uFw, uRt, uUp;
uniform float uFovk, uFocusT, uDofK, uDofMax, uReflBlur;
uniform vec4 uPool;          // key light pool on the table: centre x, z, half width, half depth
uniform vec2 uCenter;        // middle of the picture (global DIP)

float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }

// Canonical bear: 1 unit tall, feet at the origin, facing -z.
float bearSDF(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float d = sdEll(p - vec3(0.0, 0.4, 0.0), vec3(0.29, 0.33, 0.195));
  d = smin(d, sdEll(p - vec3(0.0, 0.83, -0.01), vec3(0.245, 0.215, 0.185)), 0.08);
  d = smin(d, length(q - vec3(0.175, 1.0, 0.02)) - 0.075, 0.04);
  d = smin(d, sdEll(p - vec3(0.0, 0.765, -0.155), vec3(0.105, 0.075, 0.075)), 0.05);
  d = smin(d, sdCap(q, vec3(0.21, 0.57, -0.04), vec3(0.3, 0.39, -0.13), 0.08), 0.06);
  d = smin(d, sdEll(q - vec3(0.15, 0.12, -0.05), vec3(0.125, 0.125, 0.15)), 0.07);
  d = smax(d, -(length(q - vec3(0.085, 0.865, -0.18)) - 0.026), 0.02);                      // moulded eyes
  d = smax(d, -(length(p - vec3(0.0, 0.79, -0.23)) - 0.022), 0.015);                         // nose dimple
  d = smax(d, -sdCap(q, vec3(0.0, 0.708, -0.212), vec3(0.046, 0.717, -0.196), 0.0075), 0.01); // little smile
  return d;
}

vec3 jig(vec3 p, vec4 J) {
  float s = 1.0 + J.x;
  p.y /= s;
  p.xz *= sqrt(s);
  p.x -= J.y * p.y * p.y;
  p.z -= J.z * p.y * p.y;
  return p;
}

float bearDist(vec3 p, int i) {
  vec4 P = uPos[i];
  vec3 q = uRotT[i] * (p - P.xyz) / P.w;
  return bearSDF(jig(q, uJig[i])) * P.w * 0.8;
}

vec2 mapScene(vec3 p) {
  float d = p.y;
  float id = -1.0;
  for (int i = 0; i < MAXB; i++) {
    if (i >= uCount) break;
    float db = length(p - uBound[i].xyz) - uBound[i].w;
    if (db > d) continue;
    float dd = db > 0.2 ? db : bearDist(p, i);
    if (dd < d) { d = dd; id = float(i); }
  }
  return vec2(d, id);
}

vec3 bearNormal(vec3 p, int i) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0015;
  return normalize(k.xyy * bearDist(p + k.xyy * h, i) + k.yyx * bearDist(p + k.yyx * h, i)
                 + k.yxy * bearDist(p + k.yxy * h, i) + k.xxx * bearDist(p + k.xxx * h, i));
}

float rectLight(vec3 r, vec3 dir, vec2 size, float corner, float soft) {
  float k = dot(r, dir);
  if (k <= 0.0) return 0.0;
  vec3 u = normalize(cross(dir, abs(dir.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 v = cross(u, dir);
  vec2 q = vec2(dot(r, u), dot(r, v)) / k;
  vec2 e = abs(q) - size + corner;
  float d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - corner;
  return (1.0 - smoothstep(-soft, soft, d)) * max(1.0 - 0.4 * dot(q / size, q / size), 0.2);
}

const vec3 KEY = vec3(-0.55, 0.85, -0.35);
const vec3 BACK = vec3(0.1, 1.25, 1.0);      // high behind: lights the jelly, not the table
const vec3 TRANS = vec3(0.1, 0.35, 1.0);    // light arriving through the bears from behind
const float KEYI = 4.5;
const float TABLE_ALB = 0.0035;             // black acrylic: almost all of it is reflection

vec3 env(vec3 r, float s) {
  vec3 col = vec3(0.0012, 0.0013, 0.0016) + vec3(0.0035, 0.004, 0.0055) * pow(1.0 - abs(r.y), 4.0);
  col += vec3(1.0, 0.97, 0.92) * KEYI * rectLight(r, normalize(KEY), vec2(0.42, 0.3), 0.08, s + 0.01);
  col += vec3(1.0, 0.95, 0.88) * 7.0 * rectLight(r, normalize(BACK), vec2(0.6, 0.25), 0.1, s + 0.02);
  col += vec3(0.8, 0.88, 1.0) * 3.0 * rectLight(r, normalize(vec3(1.0, 0.4, -0.2)), vec2(0.06, 0.4), 0.03, s);
  col += vec3(0.8, 0.88, 1.0) * 2.0 * rectLight(r, normalize(vec3(-1.0, 0.4, -0.1)), vec2(0.06, 0.4), 0.03, s);
  if (r.y < 0.0) col *= 0.15;   // the table below the horizon
  return col;
}

// Coloured light pools: light from the backlight passing through each bear.
vec3 caustics(vec3 p) {
  vec3 L = normalize(BACK);
  vec3 c = vec3(0.0);
  for (int i = 0; i < MAXB; i++) {
    if (i >= uCount) break;
    vec4 O = uOcc0[i];
    vec2 ctr = O.xz - L.xz / L.y * O.y;
    vec2 d = (p.xz - ctr) / (O.w * vec2(1.2, 1.7));
    float g = exp(-dot(d, d) * 2.2) * smoothstep(0.75, 0.1, O.y - O.w);
    c += exp(-uSig[i].rgb * 0.32) * g;
  }
  return c * 0.1;
}

// Key light reaching a point on the table past the bears: a soft penumbra that hardens
// near contact, a dark refraction rim, and coloured light focused through the middle.
vec3 keyShadow(vec3 p) {
  vec3 L = normalize(KEY);
  vec3 light = vec3(1.0);
  for (int i = 0; i < MAXB; i++) {
    if (i >= uCount) break;
    for (int j = 0; j < 2; j++) {
      vec4 S = j == 0 ? uOcc0[i] : uOcc1[i];
      vec3 oc = S.xyz - p;
      float tca = dot(oc, L);
      if (tca <= 0.0) continue;
      float d = sqrt(max(dot(oc, oc) - tca * tca, 0.0));
      float w = 0.015 + tca * 0.24;
      float cover = smoothstep(S.w + w, S.w - w * 0.6, d);
      if (cover <= 0.0) continue;
      float chord = 2.0 * sqrt(max(S.w * S.w - d * d, 0.0));
      vec3 tr = exp(-uSig[i].rgb * chord * 0.55);
      tr *= 0.35 + 0.65 * smoothstep(S.w, S.w * 0.5, d);
      tr *= 1.0 + 1.6 * smoothstep(S.w * 0.55, 0.0, d);
      light *= mix(vec3(1.0), tr, cover);
    }
  }
  return light;
}

// Diffuse light on the table: the key's soft pool (with the shadows) plus the backlit pools.
vec3 tableLight(vec3 p) {
  vec2 d = (p.xz - uPool.xy) / uPool.zw;
  float pool = exp(-dot(d, d) * 1.2);
  return TABLE_ALB * KEYI * normalize(KEY).y * pool * keyShadow(p) + caustics(p);
}

float tableAO(vec3 p) {
  float o = 1.0;
  for (int k = 1; k <= 3; k++) {
    float h = 0.06 * float(k);
    o -= (h - mapScene(p + vec3(0.0, h, 0.0)).x) * (0.9 / float(k));
  }
  return clamp(o, 0.2, 1.0);
}

vec3 gummy(vec3 p, vec3 rd, int i, bool cheap) {
  vec3 n = bearNormal(p, i);
  vec3 sig = uSig[i].rgb;
  // moulded jelly is never perfectly smooth: a faint, slow unevenness breaks up the highlights
  vec3 loc = uRotT[i] * (p - uPos[i].xyz) / uPos[i].w;
  vec3 nz = vec3(noise3(loc * 36.0), noise3(loc * 36.0 + 7.1), noise3(loc * 36.0 + 13.3)) - 0.5;
  n = normalize(n + nz * 0.035);
  float cosi = clamp(dot(-rd, n), 0.0, 1.0);
  float F = 0.045 + 0.955 * pow(1.0 - cosi, 5.0);
  vec3 col = env(reflect(rd, n), 0.025) * F;
  vec3 albedo = exp(-sig * 0.12);
  if (cheap) {
    col += env(rd, 0.1) * exp(-sig * 0.4) * (1.0 - F) + albedo * 0.05;
    return col;
  }
  // refract in, march through the jelly, refract out
  vec3 rIn = refract(rd, n, 1.0 / 1.45);
  vec3 ng = bearNormal(p, i);
  // Snap the hit onto the surface and start safely inside the jelly (the march stops a
  // hair outside; starting there made the thickness flicker into onion rings).
  vec3 q = p - ng * (bearDist(p, i) + 0.012);
  for (int k = 0; k < 4; k++) {
    if (-bearDist(q, i) > 0.0) break;
    q -= ng * 0.01;
  }
  float L = 0.012;
  vec3 prev = q;
  bool exited = false;
  for (int k = 0; k < 40; k++) {
    float d = -bearDist(q, i);          // > 0 while inside
    if (d < 0.0) { exited = true; break; }
    prev = q;
    float st = clamp(d * 0.85, 0.004, 0.08);
    q += rIn * st;
    L += st;
  }
  if (exited) {                         // pin the exit point down: smooth thickness, no banding
    vec3 a = prev, b = q;
    for (int k = 0; k < 6; k++) {
      vec3 m = (a + b) * 0.5;
      if (-bearDist(m, i) > 0.0) a = m; else b = m;
    }
    L -= length(q - b);
    q = b;
  }
  vec3 n2 = bearNormal(q, i);
  vec3 rOut = refract(rIn, -n2, 1.45);
  if (dot(rOut, rOut) < 0.01) rOut = reflect(rIn, -n2);   // total internal reflection
  vec3 behind = env(rOut, 0.28 + 0.12 * uSig[i].a) * 0.9;    // the jelly is slightly cloudy: light is diffused
  if (rOut.y < 0.0) behind = tableLight(q + rOut * (q.y / max(-rOut.y, 0.05))) * 4.0 + vec3(0.002);
  col += behind * exp(-sig * L) * (1.0 - F);
  // light scattered inside the slightly cloudy jelly
  float wrap = clamp((dot(n, normalize(KEY)) + 0.6) / 1.6, 0.0, 1.0);
  col += albedo * vec3(1.0, 0.97, 0.92) * wrap * 0.09 * uSig[i].a;
  col += albedo * pow(clamp(dot(rd, normalize(TRANS)), 0.0, 1.0), 4.0) * exp(-sig * L * 0.45) * 0.32;
  return col;
}

// Lens blur radius (canvas px) for WallPost: macro depth of field around uFocusT.
float coc(float t) { return (t > uFocusT ? t - uFocusT : (uFocusT - t) * 0.7) / t * uDofK; }

void main() {
  // Panoramic (cylindrical) camera: turning around the vertical axis across the width,
  // so a picture over two or three displays has no stretched bears at the sides.
  vec2 uv = (gpos() - uCenter) / uTotal.y;
  float a = uv.x * uFovk;
  float ca = cos(a), sa = sin(a);
  vec3 f2 = vec3(ca * uFw.x + sa * uFw.z, uFw.y, -sa * uFw.x + ca * uFw.z);
  vec3 u2 = vec3(ca * uUp.x + sa * uUp.z, uUp.y, -sa * uUp.x + ca * uUp.z);
  vec3 rd = normalize(f2 + u2 * (uv.y * uFovk));
  vec3 ro = uRo;
  float t = 0.0;
  vec2 h = vec2(1.0, -2.0);
  for (int k = 0; k < 110; k++) {
    h = mapScene(ro + rd * t);
    if (h.x < 0.001 * t) break;
    t += h.x;
    if (t > 22.0) { h.y = -2.0; break; }
  }
  vec3 col;
  float blur;
  if (h.y < -1.5) {
    col = env(rd, 0.05);
    blur = uDofMax;
  } else if (h.y < -0.5) {
    // glossy black table: mirror the bears, the key's light pool with coloured shadows,
    // the backlit colour pools, contact occlusion
    vec3 p = ro + rd * t;
    vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
    float F = 0.05 + 0.95 * pow(1.0 - clamp(-rd.y, 0.0, 1.0), 5.0);
    float rt = 0.01;
    vec2 rh = vec2(1.0, -2.0);
    for (int k = 0; k < 48; k++) {
      rh = mapScene(p + rr * rt);
      if (rh.x < 0.002) break;
      rt += rh.x;
      if (rt > 8.0) { rh.y = -2.0; break; }
    }
    bool hitBear = rh.y > -0.5;
    vec3 refl = hitBear ? gummy(p + rr * rt, rr, int(rh.y), true) : env(rr, 0.04 + t * 0.004);
    float ao = tableAO(p);
    col = refl * F * ao + tableLight(p) * ao + vec3(0.0006) * ao;
    // the acrylic is not a perfect mirror: reflections soften with distance from the table
    blur = max(coc(t), hitBear ? rt * uReflBlur : uDofMax);
  } else {
    col = gummy(ro + rd * t, rd, int(h.y), false);
    blur = coc(t);
  }
  col *= 1.0 - smoothstep(9.0, 20.0, t) * 0.85;      // fade into the dark studio
  outColor = vec4(col, min(blur, uDofMax));
}`);

    const post = WallPost.create(G, { threshold: [1.4, 5.0], bloom: 0.16, ca: 0.001, exposure: 0.85, vignette: 0.6, warm: 0 });
    post.resize(info.width, info.height);

    // ---------------------------------------------------------------- scene setup
    const PALETTE = [
      [0.35, 6.5, 6.5, 0.6], // red
      [0.25, 1.5, 7.5, 0.6], // orange
      [0.18, 0.32, 5.5, 0.55], // yellow
      [4.2, 0.55, 5.5, 0.6], // green
      [0.55, 0.5, 0.75, 1.3], // clear / pineapple
      [0.9, 9.0, 6.0, 0.5], // ruby
    ];
    // The canonical bear as ellipsoids [centre, radii], to rest each pose on the table.
    const PARTS = [
      [0, 0.4, 0, 0.29, 0.33, 0.195],
      [0, 0.83, -0.01, 0.245, 0.215, 0.185],
      [0.175, 1.0, 0.02, 0.075, 0.075, 0.075],
      [-0.175, 1.0, 0.02, 0.075, 0.075, 0.075],
      [0, 0.765, -0.155, 0.105, 0.075, 0.075],
      [0.3, 0.39, -0.13, 0.08, 0.08, 0.08],
      [-0.3, 0.39, -0.13, 0.08, 0.08, 0.08],
      [0.21, 0.57, -0.04, 0.08, 0.08, 0.08],
      [-0.21, 0.57, -0.04, 0.08, 0.08, 0.08],
      [0.15, 0.12, -0.05, 0.125, 0.125, 0.15],
      [-0.15, 0.12, -0.05, 0.125, 0.125, 0.15],
    ];
    const cam = { ro: [0, 1.35, -4.2], target: [0, 0.42, 0.6], fovk: 0.55 };
    const norm = (v) => {
      const l = Math.hypot(...v);
      return v.map((x) => x / l);
    };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const fw = norm(cam.target.map((x, i) => x - cam.ro[i]));
    const rt = norm(cross([0, 1, 0], fw));
    const up = cross(fw, rt);

    const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
    const rotY = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
    const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
    const matMul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
    const mulV = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);

    // Height of the feet pivot above the table so the lowest part just touches it.
    function restLift(R) {
      let lo = Infinity;
      for (const [cx, cy, cz, rx, ry, rz] of PARTS) {
        const c = mulV(R, [cx, cy, cz]);
        lo = Math.min(lo, c[1] - Math.hypot(R[1][0] * rx, R[1][1] * ry, R[1][2] * rz));
      }
      return -lo - 0.006; // settle a hair into the soft jelly: no floating
    }

    let bears = [];
    let layoutKey = '';
    let focusT = 4.6;
    let pool = [0, 0.3, 2, 1.5];
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

    // A natural scatter: most stand (some leaning a little), others lie on their backs,
    // bellies or sides; nobody overlaps, depth varies.
    function arrange(f) {
      seed = 11;
      const H = f.total[1];
      const ux1 = f.total[0] / 2 / H;
      const ux0 = -ux1;
      const n = Math.max(5, Math.min(MAXB, Math.round((ux1 - ux0) * 3.2)));
      // where one display ends and the next begins (uv), so no bear sits on a bezel
      const bezels = [];
      for (const d of f.displays || []) {
        const edge = d.x + d.w;
        if ((f.displays || []).some((o) => Math.abs(o.x - edge) < 2 && o.y < d.y + d.h && o.y + o.h > d.y)) bezels.push((edge - f.total[0] / 2) / H);
      }
      bears = [];
      for (let i = 0; i < n; i++) {
        const r = rand();
        const pose = r < 0.58 ? 'stand' : r < 0.72 ? 'back' : r < 0.85 ? 'belly' : 'side';
        const s = 0.82 + rand() * 0.32;
        let yaw = (rand() - 0.5) * 1.3;
        let pitch = (rand() - 0.6) * 0.22;
        let roll = (rand() - 0.5) * 0.14;
        if (pose === 'back') {
          pitch = Math.PI / 2 - 0.08 + rand() * 0.1;
          yaw = (rand() - 0.5) * 5;
        } else if (pose === 'belly') {
          pitch = -Math.PI / 2 + 0.08 - rand() * 0.1;
          yaw = (rand() - 0.5) * 5;
        } else if (pose === 'side') {
          roll = (rand() < 0.5 ? -1 : 1) * (Math.PI / 2 - 0.1 + rand() * 0.1);
          pitch = (rand() - 0.5) * 0.3;
        }
        let R = matMul(matMul(rotY(yaw), rotX(pitch)), rotZ(roll));
        const rad = (pose === 'stand' ? 0.34 : 0.5) * s;
        let spot = null;
        for (let tries = 0; tries < 40 && !spot; tries++) {
          let u = (ux0 + ((i + 0.5 + (rand() - 0.5) * 0.9) / n) * (ux1 - ux0)) * 0.94;
          for (const b of bezels) if (Math.abs(u - b) < 0.17) u = b + (u < b ? -0.17 : 0.17);
          const a = u * cam.fovk;
          const D = 3.8 + rand() * 1.8; // distance from the camera: front row to back row
          const x = cam.ro[0] + Math.sin(a) * D;
          const z = cam.ro[2] + Math.cos(a) * D;
          if (bears.every((o) => Math.hypot(o.cx - x, o.cz - z) > (o.rad + rad) * 0.95)) spot = [x, z, a];
        }
        if (!spot) continue;
        // standing and side-lying bears turn toward the camera wherever they are on the arc
        if (pose === 'stand' || pose === 'side') {
          yaw += spot[2];
          R = matMul(matMul(rotY(yaw), rotX(pitch)), rotZ(roll));
        }
        const off = mulV(R, [0, 0.5 * s, 0]);
        bears.push({
          cx: spot[0],
          cz: spot[1],
          rad,
          x: spot[0] - off[0],
          z: spot[1] - off[2],
          s,
          R,
          lift: restLift(R) * s,
          color: PALETTE[[0, 1, 4, 3, 2, 5][i % 6]],
          sq: 0, sqv: 0, bx: 0, bxv: 0, bz: 0, bzv: 0, hop: 0, hopv: 0,
        });
      }
      // focus on the bear nearest the middle of the main display; light pool under all of them
      let best = Infinity;
      for (const b of bears) {
        const c = project([b.cx, 0.45 * b.s, b.cz], f);
        const d = Math.abs(c.x - f.focus[0]) + Math.abs(c.y - f.focus[1]) * 0.5;
        if (d < best) {
          best = d;
          focusT = Math.hypot(b.cx - cam.ro[0], 0.45 * b.s - cam.ro[1], b.cz - cam.ro[2]);
        }
      }
      const xs = bears.map((b) => b.cx);
      const zs = bears.map((b) => b.cz);
      pool = [
        (Math.min(...xs) + Math.max(...xs)) / 2 - 0.2,
        (Math.min(...zs) + Math.max(...zs)) / 2 + 0.2,
        (Math.max(...xs) - Math.min(...xs)) / 2 + 1.3,
        (Math.max(...zs) - Math.min(...zs)) / 2 + 1.2,
      ];
    }

    // world point -> global DIP, matching the shader's panoramic camera
    function project(P, f) {
      const d = P.map((x, i) => x - cam.ro[i]);
      const a = Math.atan2(d[0], d[2]); // the camera looks along +z
      const c = Math.cos(-a);
      const sn = Math.sin(-a);
      const r = [c * d[0] + sn * d[2], d[1], -sn * d[0] + c * d[2]];
      const zc = r[0] * fw[0] + r[1] * fw[1] + r[2] * fw[2];
      const yc = r[0] * up[0] + r[1] * up[1] + r[2] * up[2];
      const H = f.total[1];
      return { x: f.total[0] / 2 + (a / cam.fovk) * H, y: f.total[1] / 2 + (yc / zc / cam.fovk) * H, k: H / zc / cam.fovk };
    }

    // world position of a point given in the bear's canonical space
    const toWorld = (b, v) => {
      const w = mulV(b.R, v);
      return [b.x + w[0] * b.s, b.lift + b.hop + w[1] * b.s, b.z + w[2] * b.s];
    };

    const posBuf = new Float32Array(MAXB * 4);
    const rotBuf = new Float32Array(MAXB * 9);
    const boundBuf = new Float32Array(MAXB * 4);
    const jigBuf = new Float32Array(MAXB * 4);
    const sigBuf = new Float32Array(MAXB * 4);
    const occ0Buf = new Float32Array(MAXB * 4);
    const occ1Buf = new Float32Array(MAXB * 4);
    let prevBeat = 0;
    let nextIdle = 0;

    function poke(b, vx, vy, amt) {
      b.bxv += vx * amt;
      b.bzv += -vy * amt * 0.4;
      b.sqv -= Math.abs(amt) * 0.6;
    }

    // Bears at rest don't need redrawing: the last frame simply stays on screen.
    let dirty = true;
    return {
      invalidate() {
        dirty = true;
      },
      resize(w, h) {
        post.resize(w, h);
        dirty = true;
      },
      render(f) {
        const key = `${f.total}|${f.focus}`;
        if (key !== layoutKey) {
          layoutKey = key;
          arrange(f);
          dirty = true;
        }
        const dt = Math.min(f.dt, 1 / 30);

        // ---- interaction: brush, click to hop, beat jiggle, idle wobble
        for (const b of bears) {
          const c = project(toWorld(b, [0, 0.5, 0]), f);
          const r = 0.5 * b.s * c.k;
          b._scr = c;
          b._r = r;
          if (f.mouse.active && f.mouse.speed > 30) {
            const dx = f.mouse.gx - c.x;
            const dy = f.mouse.gy - c.y;
            if (dx * dx + dy * dy < r * r) {
              const sp = Math.min(1, f.mouse.speed / 2500);
              poke(b, Math.sign(f.mouse.vx) * sp, Math.sign(f.mouse.vy) * sp, 2.2 * dt * 60 * 0.12);
            }
          }
        }
        for (const cl of f.clicks) {
          let best = null;
          let bd = Infinity;
          for (const b of bears) {
            const d = Math.hypot(cl.gx - b._scr.x, cl.gy - b._scr.y);
            if (d < b._r * 1.3 && d < bd) {
              bd = d;
              best = b;
            }
          }
          if (best) {
            best.hopv = 2.6;
            best.sqv += 2.5;
          }
        }
        if (f.audio.beat > prevBeat + 0.5) {
          for (const b of bears) {
            b.sqv -= 0.9 * (0.4 + f.audio.bass);
            b.bxv += (Math.random() - 0.5) * 0.6;
          }
        }
        prevBeat = f.audio.beat;
        if (f.time > nextIdle || f.time < nextIdle - 20) {
          const b = bears[Math.floor(Math.random() * bears.length)];
          if (b) poke(b, Math.random() - 0.5, 0, 0.5);
          nextIdle = f.time + 8 + Math.random() * 8; // rare: every wobble means frames to render
        }

        // ---- jelly springs + hop with gravity and a squashy landing
        for (const b of bears) {
          const k = 170;
          const c = 5.5;
          b.sqv += (-k * b.sq - c * b.sqv) * dt;
          b.sq += b.sqv * dt;
          b.bxv += (-120 * b.bx - 4 * b.bxv) * dt;
          b.bx += b.bxv * dt;
          b.bzv += (-120 * b.bz - 4 * b.bzv) * dt;
          b.bz += b.bzv * dt;
          if (b.hop > 0 || b.hopv > 0) {
            b.hopv -= 9.8 * dt;
            b.hop += b.hopv * dt;
            if (b.hop <= 0) {
              b.hop = 0;
              b.sqv -= Math.abs(b.hopv) * 1.1;
              b.hopv = b.hopv < -1 ? -b.hopv * 0.25 : 0;
            }
          }
          b.sq = Math.max(-0.35, Math.min(0.35, b.sq));
        }

        const motion = bears.reduce((m, b) => m + Math.abs(b.sq) + Math.abs(b.sqv) * 0.05 + Math.abs(b.bx) + Math.abs(b.bxv) * 0.05 + Math.abs(b.bz) + b.hop + Math.abs(b.hopv), 0);
        // the pointer only matters once it pokes a bear (which shows up as motion)
        if (!dirty && motion < 0.004 && !f.clicks.length) return;
        dirty = motion >= 0.004;
        const n = bears.length;
        bears.forEach((b, i) => {
          const R = b.R;
          posBuf.set([b.x, b.lift + b.hop, b.z, b.s], i * 4);
          // column-major R^T == row-major R
          rotBuf.set([R[0][0], R[0][1], R[0][2], R[1][0], R[1][1], R[1][2], R[2][0], R[2][1], R[2][2]], i * 9);
          boundBuf.set([...toWorld(b, [0, 0.5, 0]), 0.66 * b.s * (1 + Math.abs(b.sq))], i * 4);
          jigBuf.set([b.sq, b.bx * 0.35, b.bz * 0.35, 0], i * 4);
          sigBuf.set(b.color, i * 4);
          occ0Buf.set([...toWorld(b, [0, 0.42, 0]), 0.3 * b.s], i * 4);
          occ1Buf.set([...toWorld(b, [0, 0.84, -0.01]), 0.24 * b.s], i * 4);
        });

        G.draw(shade, post.target, (p) => {
          G.common(p, f);
          gl.uniform1i(p.u('uCount'), n);
          gl.uniform4fv(p.u('uPos'), posBuf);
          gl.uniformMatrix3fv(p.u('uRotT'), false, rotBuf);
          gl.uniform4fv(p.u('uBound'), boundBuf);
          gl.uniform4fv(p.u('uJig'), jigBuf);
          gl.uniform4fv(p.u('uSig'), sigBuf);
          gl.uniform4fv(p.u('uOcc0'), occ0Buf);
          gl.uniform4fv(p.u('uOcc1'), occ1Buf);
          gl.uniform3f(p.u('uRo'), cam.ro[0], cam.ro[1], cam.ro[2]);
          gl.uniform3f(p.u('uFw'), fw[0], fw[1], fw[2]);
          gl.uniform3f(p.u('uRt'), rt[0], rt[1], rt[2]);
          gl.uniform3f(p.u('uUp'), up[0], up[1], up[2]);
          gl.uniform1f(p.u('uFovk'), cam.fovk);
          gl.uniform1f(p.u('uFocusT'), focusT);
          gl.uniform1f(p.u('uDofK'), f.height * 0.03);
          gl.uniform1f(p.u('uDofMax'), f.height * 0.016);
          gl.uniform1f(p.u('uReflBlur'), f.height * 0.006);
          gl.uniform4f(p.u('uPool'), pool[0], pool[1], pool[2], pool[3]);
          gl.uniform2f(p.u('uCenter'), f.total[0] / 2, f.total[1] / 2);
        });
        post.run(f);
      },
      dispose() {
        post.dispose();
        gl.deleteProgram(shade.p);
      },
    };
  },
});
