// Warp — the view from a starship's bridge at warp.
//
// Tens of thousands of stars stream past as motion-blurred streaks — points straight
// ahead (blue-shifted, they come head-on), long lines at the sides, each streak shading
// from a blue-white head to a warmer tail. Four layers give real parallax: distant stars,
// close streaks that fill the side screens, fine dust, and now and then a big star that
// whooshes past close by. Behind them: the Milky Way with its dust lanes, the blue glow of
// the warp field, subspace ripples and plasma wisps rushing outward, nebula gas.
//
// Every minute or two (or when you click) the ship drops out of warp next to a planet
// generated on the spot — a banded gas giant with a storm, a cratered desert world, an
// Earth-like world with oceans, clouds, ice caps and city lights on its night side, an
// ice world, a lava world glowing through its cracks, an ocean world — in random colours
// and sizes, slowly turning, sometimes with rings (casting and catching shadows), a moon,
// the sun in view, or lit from behind as a crescent. Out of warp the bright stars show
// diffraction spikes. Then it engages again: the stars stretch, a flash, a shockwave,
// the ship shudders, and it's gone at warp.
//
// The main display is the viewscreen (the course is its centre); the other displays are
// side viewports where everything rushes past. The pointer steers; the music pushes.
WallEngine.register({
  id: 'warp',
  name: 'Warp',
  desc: 'Starship at warp — click to drop out next to a new planet, click again to engage',
  order: 4,
  span: true, // the main display is the viewscreen, the others are side viewports
  resolution: 0.75,
  create(G, info) {
    const { gl } = G;
    const FOVK = 0.55; // radians per picture height

    // ---------------------------------------------------------------- space behind the stars
    const bgP = G.program(`
uniform vec2 uVP;          // vanishing point (global DIP)
uniform float uFovk, uDist, uWarp, uFlash, uRing, uRingA, uPlanet, uSeed, uTimeP;
uniform mat3 uRotT;        // view -> ship
uniform vec3 uNebA, uNebB, uGal;
// the planet system
uniform vec4 uPl;          // direction (xyz) + angular radius
uniform float uPlType;     // 0 gas giant, 1 rocky, 2 earth-like, 3 ice, 4 lava, 5 ocean
uniform vec3 uPlC1, uPlC2, uPlC3, uPlAtm, uSun;
uniform vec4 uPlAx;        // spin axis + angle
uniform vec4 uRingP;       // inner, outer (planet radii), opacity, on
uniform vec3 uRingN, uRingC;
uniform vec4 uMoon;        // direction + angular radius (0 = none)
uniform float uSunVis;

vec3 rotAxis(vec3 v, vec3 k, float a) { return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a)); }

// ---- planet surfaces: colour (rgb) + emission in the dark (a)
vec4 surface(vec3 N, vec3 L, float type) {
  vec3 q = rotAxis(N, uPlAx.xyz, uPlAx.w);
  float lat = dot(N, uPlAx.xyz);
  float day = smoothstep(-0.08, 0.3, dot(N, L));
  vec3 c;
  float glow = 0.0;
  if (type < 0.5) {                                      // gas giant: bands, turbulence, a storm
    float w = fbm3(q * 2.6 + uSeed) * 0.9;
    float b = sin(lat * (14.0 + uSeed * 0.2) + w * 3.5);
    float fine = fbm3(vec3(lat * 40.0, q.x * 3.0, q.z * 3.0) + uSeed);
    c = mix(uPlC1, uPlC2, b * 0.5 + 0.5);
    c = mix(c, uPlC3, smoothstep(0.55, 0.8, fine) * 0.55);
    vec3 sp = normalize(vec3(0.8, -0.35, 0.5));
    float storm = smoothstep(0.16, 0.0, length(q - sp) - 0.02);
    c = mix(c, uPlC3 * vec3(1.15, 0.8, 0.7), storm * 0.8);
  } else if (type < 1.5) {                               // rocky / desert, cratered
    float h = fbm3(q * 3.5 + uSeed);
    c = mix(uPlC2, uPlC1, smoothstep(0.3, 0.7, h));
    vec3 g = q * 9.0 + uSeed;
    vec3 cell = floor(g);
    float cr = 0.0;
    for (int i = 0; i < 2; i++) {
      vec3 o = hash33(cell + float(i) * 7.0);
      float r = length(fract(g) - o);
      cr += smoothstep(0.32, 0.26, r) * 0.25 - smoothstep(0.26, 0.15, r) * 0.35;
    }
    c *= 1.0 + cr;
    c = mix(c, uPlC3, smoothstep(0.62, 0.75, fbm3(q * 7.0 + 3.0)) * 0.4);
  } else if (type < 2.5) {                               // Earth-like
    float h = fbm3(q * 2.2 + uSeed + 3.0) + 0.25 * fbm3(q * 7.0);
    float land = smoothstep(0.62, 0.66, h);
    vec3 ocean = uPlC1 * (0.7 + 0.3 * fbm3(q * 6.0));
    vec3 ground = mix(uPlC2, uPlC3, smoothstep(0.7, 0.85, h));
    c = mix(ocean, ground, land);
    c = mix(c, vec3(0.92, 0.95, 1.0), smoothstep(0.78, 0.86, abs(lat) + fbm3(q * 5.0) * 0.08));
    vec3 cq = rotAxis(N, uPlAx.xyz, uPlAx.w * 1.35);
    float clouds = smoothstep(0.52, 0.78, fbm3(cq * 3.2 + 11.0 + uSeed));
    c = mix(c, vec3(1.0), clouds * 0.85);
    glow = land * (1.0 - clouds) * smoothstep(0.55, 0.72, fbm3(q * 22.0)) * (1.0 - smoothstep(0.75, 0.85, abs(lat)));
  } else if (type < 3.5) {                               // ice world with cracks
    float h = fbm3(q * 3.0 + uSeed);
    c = mix(uPlC2, uPlC1, smoothstep(0.35, 0.7, h));
    float crack = 1.0 - smoothstep(0.0, 0.025, abs(fbm3(q * 5.0 + 7.0) - 0.5));
    c = mix(c, uPlC2 * 0.55, crack * 0.7);
    c = mix(c, uPlC3, smoothstep(0.7, 0.9, abs(lat)));
  } else if (type < 4.5) {                               // lava world: dark crust, glowing cracks
    float h = fbm3(q * 3.0 + uSeed);
    c = mix(uPlC1, uPlC2, smoothstep(0.4, 0.7, h));
    float crack = 1.0 - smoothstep(0.0, 0.035, abs(fbm3(q * 4.0 + 5.0) - 0.5));
    float pools = smoothstep(0.66, 0.72, fbm3(q * 2.5 + 9.0));
    glow = max(crack, pools) * 1.6;
  } else {                                               // ocean world
    float h = fbm3(q * 3.0 + uSeed);
    c = mix(uPlC1, uPlC2, smoothstep(0.35, 0.75, h));
    vec3 cq = rotAxis(N, uPlAx.xyz, uPlAx.w * 1.5);
    float clouds = smoothstep(0.5, 0.8, fbm3(cq * 3.6 + 5.0 + uSeed)) * 0.9;
    c = mix(c, uPlC3, clouds);
    c = mix(c, vec3(0.95), smoothstep(0.82, 0.9, abs(lat)));
  }
  return vec4(c, glow * (1.0 - day));
}

vec3 moonSurface(vec3 N) {
  float h = fbm3(N * 5.0 + 21.0);
  vec3 g = N * 10.0 + 4.0;
  vec3 o = hash33(floor(g));
  float r = length(fract(g) - o);
  float cr = smoothstep(0.3, 0.24, r) * 0.2 - smoothstep(0.24, 0.12, r) * 0.3;
  return vec3(0.55, 0.53, 0.5) * (0.7 + 0.5 * h) * (1.0 + cr);
}

// planet, rings, moon, sun, along the view direction s (ship space)
vec3 planetSystem(vec3 s, vec3 col) {
  vec3 C = normalize(uPl.xyz);
  float R = sin(uPl.w);
  vec3 L = uSun;
  // the sun, when it's in view
  float sd = dot(s, L);
  col += vec3(1.0, 0.95, 0.86) * uSunVis * (smoothstep(0.99955, 0.9998, sd) * 25.0 + pow(max(sd, 0.0), 300.0) * 1.5 + pow(max(sd, 0.0), 20.0) * 0.06);
  // moon (behind or beside the planet)
  if (uMoon.w > 0.0) {
    vec3 Cm = normalize(uMoon.xyz) * 1.4;
    float Rm = sin(uMoon.w) * 1.4;
    float bm = dot(s, Cm);
    float hm = bm * bm - (dot(Cm, Cm) - Rm * Rm);
    if (hm > 0.0) {
      vec3 Nm = normalize(s * (bm - sqrt(hm)) - Cm);
      col = moonSurface(Nm) * (max(dot(Nm, L), 0.0) * 1.3 + 0.004);
    }
  }
  float b = dot(s, C);
  float h = b * b - (1.0 - R * R);
  float tP = -1.0;
  if (h > 0.0) {
    tP = b - sqrt(h);
    vec3 P = s * tP;
    vec3 N = (P - C) / R;
    vec4 sf = surface(N, L, uPlType);
    float lit = max(dot(N, L), 0.0);
    // shadow of the rings on the planet
    if (uRingP.w > 0.5) {
      float dl = dot(L, uRingN);
      if (abs(dl) > 1e-3) {
        float tr = dot(C - P, uRingN) / dl;
        if (tr > 0.0) {
          float rr = length(P + L * tr - C) / R;
          if (rr > uRingP.x && rr < uRingP.y) lit *= 1.0 - 0.7 * uRingP.z;
        }
      }
    }
    vec3 pc = sf.rgb * (lit * 1.35 + 0.018);   // faint fill on the night side
    // ocean glint on water worlds
    if (uPlType > 1.5 && uPlType < 2.5 || uPlType > 4.5) pc += vec3(1.0, 0.95, 0.85) * pow(max(dot(reflect(-L, N), -s), 0.0), 60.0) * 0.6 * lit;
    pc += (uPlType > 3.5 && uPlType < 4.5 ? vec3(1.0, 0.32, 0.05) : vec3(1.0, 0.78, 0.45)) * sf.a * 0.5;
    float rim = pow(1.0 - max(dot(N, -s), 0.0), 2.5);
    pc += uPlAtm * rim * (0.08 + 1.2 * max(dot(N, L) + 0.25, 0.0));
    col = pc;
  } else {
    // atmosphere glow just past the limb
    float ang = acos(clamp(b, -1.0, 1.0));
    float g = exp(-(ang - uPl.w) * 35.0) * step(uPl.w, ang);
    col += uPlAtm * g * 0.4 * max(dot(normalize(s - C * b), L) + 0.35, 0.0);
  }
  // rings (in front of the planet, or hidden behind it)
  if (uRingP.w > 0.5) {
    float dn = dot(s, uRingN);
    if (abs(dn) > 1e-4) {
      float tR = dot(C, uRingN) / dn;
      if (tR > 0.0 && (tP < 0.0 || tR < tP)) {
        vec3 o = s * tR - C;
        float rr = length(o) / R;
        if (rr > uRingP.x && rr < uRingP.y) {
          float u = (rr - uRingP.x) / (uRingP.y - uRingP.x);
          float dens = (0.3 + 0.7 * noise(vec2(rr * 55.0, uSeed))) * smoothstep(0.0, 0.06, u) * smoothstep(1.0, 0.88, u);
          dens *= 1.0 - 0.85 * smoothstep(0.5, 0.52, u) * smoothstep(0.6, 0.58, u);   // a gap
          float bo = dot(o, L);
          float hs = bo * bo - (dot(o, o) - R * R);
          float sh = (bo < 0.0 && hs > 0.0) ? 0.06 : 1.0;                         // planet's shadow
          vec3 rc = uRingC * (0.2 + 1.1 * abs(dot(uRingN, L))) * sh;
          col = mix(col, rc, clamp(dens * uRingP.z, 0.0, 1.0));
        }
      }
    }
  }
  return col;
}

void main() {
  vec2 uv = (gpos() - uVP) / uTotal.y;
  float a = uv.x * uFovk;
  vec3 d = normalize(vec3(sin(a), uv.y * uFovk, cos(a)));
  vec3 s = uRotT * d;
  float psi = acos(clamp(s.z, -1.0, 1.0));            // angle from the course
  float phi = atan(s.y, s.x);
  // the warp field bends the light a little near the course
  psi += sin(psi * 30.0 - uDist * 0.004) * 0.006 * uWarp * smoothstep(0.6, 0.0, psi);
  float tz = 1.0 / max(tan(psi), 0.002);              // depth along a unit tube
  float flow = tz + uDist * 0.012;                     // features rush toward us
  vec2 cs = vec2(cos(phi), sin(phi));

  vec3 col = vec3(0.0012, 0.0016, 0.0045);
  // the Milky Way: a band with dust lanes and a haze of unresolved stars
  float g = dot(s, uGal);
  float band = exp(-g * g * 22.0);
  float cloud = fbm3(s * 3.2 + uSeed);
  float lanes = smoothstep(0.45, 0.62, fbm3(s * 6.0 + uSeed + 4.0));
  float grain = pow(noise3(s * 420.0), 18.0) * 3.0 + pow(noise3(s * 160.0 + 3.0), 10.0);
  col += mix(vec3(0.55, 0.62, 0.85), vec3(0.95, 0.82, 0.62), cloud) * band * (cloud * 0.03 + grain * 0.05) * (1.0 - lanes * 0.85);

  // nebula gas streaming past, thickest a little off the course
  float n1 = fbm3(vec3(cs * 1.6, flow * 0.05) + uSeed);
  float n2 = fbm3(vec3(cs * 3.4 + 5.0, flow * 0.11 + 3.0) + uSeed);
  float gas = smoothstep(0.42, 0.85, n1) * (0.55 + 0.45 * n2);
  float bandN = smoothstep(0.02, 0.25, psi) * smoothstep(1.6, 0.5, psi);
  col += mix(uNebA, uNebB, smoothstep(0.3, 0.7, n2)) * gas * bandN * (0.04 + 0.2 * uWarp);

  // warp field: blue glow around the course, wider violet haze
  col += vec3(0.22, 0.42, 1.0) * exp(-psi * 9.0) * (0.03 + 0.45 * uWarp);
  col += vec3(0.45, 0.3, 1.0) * exp(-psi * 2.4) * 0.05 * uWarp;
  // subspace ripples rushing outward
  float rip = pow(max(sin(log(tz + 1.0) * 14.0 - uDist * 0.0055), 0.0), 18.0);
  col += vec3(0.3, 0.55, 1.0) * rip * smoothstep(0.03, 0.2, psi) * smoothstep(1.2, 0.3, psi) * 0.1 * uWarp;
  // plasma wisps: thin streaks of the warp field whipping past at the sides
  float wisp = pow(fbm3(vec3(cs * 9.0, flow * 0.5 + uSeed)), 5.0) * 6.0;
  col += vec3(0.35, 0.5, 1.0) * wisp * smoothstep(0.25, 0.9, psi) * smoothstep(1.7, 1.0, psi) * 0.12 * uWarp;

  if (uPlanet > 0.001) col = mix(col, planetSystem(s, col), uPlanet);

  // engage: flash at the vanishing point, anamorphic streak, shockwave ring
  col += vec3(0.7, 0.85, 1.0) * uFlash * (exp(-psi * 6.0) * 2.2 + exp(-abs(uv.y) * 70.0) * exp(-abs(uv.x) * 1.1) * 1.8);
  col += vec3(0.35, 0.6, 1.0) * exp(-abs(uv.y) * 140.0) * exp(-abs(uv.x) * 0.9) * 0.22 * uWarp;
  col += vec3(0.5, 0.75, 1.0) * exp(-pow((psi - uRing) * 18.0, 2.0)) * uRingA;
  outColor = vec4(col, 0.0);
}`);

    // ---------------------------------------------------------------- stars as streak quads
    const starVS = `#version 300 es
precision highp float;
uniform vec2 uFrame, uVP;
uniform float uPx;              // pixels per radian
uniform mat3 uRot;              // ship -> view
uniform float uDist, uStreak, uNear, uFar, uRMin, uRMax, uBright, uWidth, uWarp, uLayer, uOnlyWarp;
uniform vec4 uPl;               // planet direction + angular radius (it hides the stars behind it)
uniform float uPlanet;
out vec3 vCol;
out vec2 vQ;
out float vLen;
out float vSpike;
// integer hashing: sin()-based hashes repeat on GPUs and line stars up in rows
uint hu(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float hf(uint x) { return float(hu(x) >> 8) / 16777216.0; }
vec2 proj(vec3 P) {
  vec3 Q = uRot * P;
  float a = atan(Q.x, Q.z);
  float rho = length(Q.xz);
  return uVP + vec2(a, Q.y / max(rho, 1e-3)) * uPx;
}
void main() {
  int id = gl_VertexID / 6;
  int corner = gl_VertexID - id * 6;
  uint base = hu(uint(id) * 3u + uint(uLayer) * 1000003u + 17u);
  float D = uFar - uNear;
  float travel = uDist + hf(base ^ 0x51ed27u) * D;
  float cyc = floor(travel / D);
  float z = uFar - mod(travel, D);
  uint cb = hu(base ^ (uint(cyc) * 2654435761u));
  float r1 = hf(cb);
  float r2 = hf(cb ^ 0x9e3779b9u);
  float r3 = hf(cb ^ 0x85ebca6bu);
  // Two kinds of stars in the distant layer: sky stars spread evenly in every direction
  // (the calm starfield out of warp), and tunnel stars close around the course that only
  // light up at warp, where they make the tunnel.
  bool tunnel = uLayer < 0.5 && hf(base ^ 0x2545f491u) < 0.45;
  float rad = uLayer < 0.5 && !tunnel
    ? uFar * 2.6 * sqrt(r1) + uRMin
    : sqrt(mix(uRMin * uRMin, uRMax * uRMax, r1)) * (0.3 + 1.5 * z / uFar);
  float th = r2 * 6.2831853;
  vec3 head = vec3(cos(th) * rad, sin(th) * rad, z);
  vec3 tail = head + vec3(0.0, 0.0, uStreak);
  vec2 Hp = proj(head);
  vec2 Tp = proj(tail);
  vec2 dir = Hp - Tp;
  float L = length(dir);
  dir = L > 1e-3 ? dir / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float mag = 0.3 + 3.2 * pow(r3, 7.0);                    // a few very bright stars
  // out of warp, the very brightest sky stars get a larger sprite for diffraction spikes
  vSpike = clamp((mag - 2.4) * 1.5, 0.0, 1.0) * (1.0 - uWarp) * step(uLayer, 0.5) * (tunnel ? 0.0 : 1.0);
  float w = uWidth * (0.75 + 0.35 * min(mag, 2.5)) * (1.0 + 2.0 / max(z, 1.0)) * (1.0 + vSpike * 3.5);
  vec2 c;
  vec2 q;
  if (corner == 0 || corner == 3) { c = Tp - nrm * w - dir * w; q = vec2(-1.0, 0.0); }
  else if (corner == 1) { c = Tp + nrm * w - dir * w; q = vec2(1.0, 0.0); }
  else if (corner == 2 || corner == 4) { c = Hp + nrm * w + dir * w; q = vec2(1.0, 1.0); }
  else { c = Hp - nrm * w + dir * w; q = vec2(-1.0, 1.0); }
  gl_Position = vec4(c / uFrame * 2.0 - 1.0, 0.0, 1.0);
  vQ = q;
  vLen = L;
  // colour: star temperature, blue-shifted ahead while at warp
  float tk = hf(base ^ 0x68e31da4u);
  vec3 col = tk < 0.1 ? vec3(1.0, 0.62, 0.36) : tk < 0.28 ? vec3(1.0, 0.88, 0.72) : tk < 0.85 ? vec3(0.86, 0.92, 1.0) : vec3(0.62, 0.76, 1.0);
  float ahead = smoothstep(0.6, 0.05, atan(rad, max(z, 0.01)));
  col = mix(col, vec3(0.5, 0.72, 1.0), uWarp * ahead * 0.7);
  float fade = smoothstep(uFar, uFar * 0.8, z) * smoothstep(uNear, uNear * 2.5, z);
  if (tunnel) fade *= mix(0.05, 0.7, uWarp);
  fade *= mix(1.0, uWarp, uOnlyWarp);
  if (uPlanet > 0.01) {
    float ang = acos(clamp(dot(normalize(head), normalize(uPl.xyz)), -1.0, 1.0));
    fade *= 1.0 - uPlanet * smoothstep(uPl.w, uPl.w * 0.96, ang);
  }
  vCol = col * mag * uBright * fade;
}`;
    const starFS = `#version 300 es
precision highp float;
in vec3 vCol;
in vec2 vQ;
in float vLen;
in float vSpike;
out vec4 o;
void main() {
  float ay = vQ.y * 2.0 - 1.0;
  float dot_ = 1.0 - smoothstep(3.0, 12.0, vLen);          // 1 when the star is (nearly) still
  // streak: thin bright core, bright head, Doppler-warm fading tail
  float across = exp(-vQ.x * vQ.x * 3.2);
  float along = mix(0.1, 1.0, vQ.y * vQ.y);
  vec3 tint = mix(vec3(1.0, 0.72, 0.55), vec3(0.88, 0.94, 1.0), vQ.y);
  float spread = mix(1.0, 0.35, smoothstep(8.0, 220.0, vLen));
  vec3 streak = vCol * tint * across * along * spread;
  // still star: round core plus diffraction spikes for the bright ones
  float r2 = vQ.x * vQ.x + ay * ay;
  float k = 1.0 + vSpike * 3.5;
  float core = exp(-r2 * 3.5 * k * k);
  float spikes = vSpike * (exp(-abs(vQ.x) * 26.0) * exp(-abs(ay) * 3.4) + exp(-abs(ay) * 26.0) * exp(-abs(vQ.x) * 3.4)) * 0.35;
  vec3 still = vCol * (core * 1.4 + spikes);
  o = vec4(mix(streak, still, dot_), 0.0);
}`;
    const starP = (() => {
      const mk = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('warp stars: ' + gl.getShaderInfoLog(sh));
        return sh;
      };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, starVS));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, starFS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const locs = {};
      return { p, u: (n) => (n in locs ? locs[n] : (locs[n] = gl.getUniformLocation(p, n))) };
    })();
    const emptyVao = gl.createVertexArray();

    const post = WallPost.create(G, { dof: false, threshold: [0.8, 3.0], bloom: 0.5, ca: 0.0028, exposure: 1.05, vignette: 0.55, warm: 0 });
    post.resize(info.width, info.height);

    // four layers: distant stars, close side-rushing streaks, fine dust, close fly-bys
    const LAYERS = info.preview
      ? [
          { n: 2500, near: 1, far: 900, rMin: 2, rMax: 110, k: 1, w: 0.9, b: 1.0 },
          { n: 600, near: 0.6, far: 70, rMin: 4, rMax: 40, k: 0.22, w: 0.8, b: 0.7 },
        ]
      : [
          { n: 16000, near: 1, far: 900, rMin: 2, rMax: 110, k: 1, w: 1.0, b: 1.0 },
          { n: 6000, near: 0.6, far: 70, rMin: 4, rMax: 40, k: 0.22, w: 1.0, b: 0.75 },
          { n: 3000, near: 0.3, far: 18, rMin: 0.8, rMax: 7, k: 0.08, w: 0.6, b: 0.22 },
          { n: 40, near: 2, far: 600, rMin: 7, rMax: 30, k: 0.55, w: 2.6, b: 3.2, onlyWarp: 1 },
        ];

    // ---------------------------------------------------------------- generators
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pickW = (w) => {
      let r = Math.random() * w.reduce((x, y) => x + y, 0);
      for (let i = 0; i < w.length; i++) if ((r -= w[i]) < 0) return i;
      return 0;
    };
    // HSL -> linear RGB
    const hsl = (h, s, l) => {
      h = ((h % 1) + 1) % 1;
      const a = s * Math.min(l, 1 - l);
      const f = (n) => {
        const k = (n + h * 12) % 12;
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
      return [f(0), f(8), f(4)].map((v) => Math.pow(Math.max(0, v), 2.2));
    };
    const norm = (v) => {
      const l = Math.hypot(...v) || 1;
      return v.map((x) => x / l);
    };
    const NEB = [
      [[0.1, 0.5, 0.9], [0.7, 0.2, 0.9]],
      [[1.0, 0.35, 0.1], [0.9, 0.1, 0.3]],
      [[0.1, 0.9, 0.7], [0.2, 0.4, 1.0]],
      [[0.9, 0.2, 0.6], [0.3, 0.3, 1.0]],
      [[0.4, 0.9, 0.3], [0.1, 0.6, 0.9]],
      [[1.0, 0.7, 0.2], [0.6, 0.2, 0.9]],
    ];

    // A new planet every time: kind, colours, size, spin, rings, moon, light.
    function makePlanet(side, room) {
      const type = pickW([0.22, 0.15, 0.2, 0.13, 0.14, 0.16]);
      const hue = Math.random();
      let c1, c2, c3, atm;
      if (type === 0) {
        c1 = hsl(hue, rnd(0.3, 0.6), rnd(0.55, 0.7));
        c2 = hsl(hue + rnd(-0.06, 0.06), rnd(0.35, 0.65), rnd(0.32, 0.45));
        c3 = hsl(hue + rnd(-0.15, 0.15), rnd(0.4, 0.8), rnd(0.65, 0.82));
        atm = hsl(hue, 0.5, 0.75);
      } else if (type === 1) {
        const h = rnd(0.0, 0.12);
        c1 = hsl(h, rnd(0.25, 0.5), rnd(0.45, 0.62));
        c2 = hsl(h + 0.02, rnd(0.2, 0.4), rnd(0.2, 0.32));
        c3 = hsl(h, 0.15, 0.75);
        atm = Math.random() < 0.5 ? hsl(h, 0.4, 0.7) : [0.05, 0.05, 0.05];
      } else if (type === 2) {
        c1 = hsl(rnd(0.55, 0.64), rnd(0.6, 0.8), rnd(0.18, 0.3));
        c2 = hsl(rnd(0.2, 0.32), rnd(0.35, 0.55), rnd(0.22, 0.32));
        c3 = hsl(rnd(0.07, 0.12), rnd(0.25, 0.4), rnd(0.4, 0.55));
        atm = [0.3, 0.55, 1.0];
      } else if (type === 3) {
        c1 = hsl(rnd(0.5, 0.6), rnd(0.15, 0.35), rnd(0.8, 0.9));
        c2 = hsl(rnd(0.52, 0.62), rnd(0.35, 0.6), rnd(0.5, 0.65));
        c3 = [0.95, 0.97, 1.0];
        atm = [0.55, 0.8, 1.0];
      } else if (type === 4) {
        c1 = hsl(rnd(0.0, 0.05), 0.2, rnd(0.08, 0.14));
        c2 = hsl(rnd(0.02, 0.08), 0.15, rnd(0.18, 0.26));
        c3 = [1.0, 0.4, 0.05];
        atm = [1.0, 0.35, 0.08];
      } else {
        c1 = hsl(rnd(0.52, 0.66), rnd(0.65, 0.85), rnd(0.22, 0.34));
        c2 = hsl(rnd(0.5, 0.6), rnd(0.6, 0.8), rnd(0.38, 0.5));
        c3 = [0.97, 0.98, 1.0];
        atm = [0.35, 0.6, 1.0];
      }
      const huge = Math.random() < 0.15;
      const r = huge ? rnd(0.38, 0.5) : rnd(0.1, 0.28);
      // room: how far (radians) the picture reaches on that side — keep the planet in it
      const maxAz = Math.max(0.12, room * FOVK - r * 1.15 - 0.05);
      const az = Math.min(rnd(0.3, 0.85), maxAz) * (huge ? 1.1 : 1);
      const dir = [side * Math.sin(az), rnd(-0.22, 0.15), Math.cos(az)];
      const ringChance = [0.55, 0.12, 0.08, 0.3, 0.06, 0.15][type];
      const ring = Math.random() < ringChance;
      const backlit = !huge && Math.random() < 0.18; // a crescent — never for a planet filling the view
      // light: mostly from the viewer's side so the face is lit; sometimes a crescent
      const sun = norm(backlit ? [rnd(-0.6, 0.6), rnd(-0.1, 0.4), 1] : [-side * rnd(0.2, 1.1), rnd(-0.2, 0.7), -rnd(0.3, 1.2)]);
      const moon = Math.random() < 0.5;
      const ma = rnd(0.3, 0.7) * (Math.random() < 0.5 ? -1 : 1);
      const mdir = [dir[0] * Math.cos(ma) - dir[2] * Math.sin(ma) * 0.4, dir[1] + rnd(-0.2, 0.2), dir[2] * Math.cos(ma) + dir[0] * Math.sin(ma) * 0.4];
      return {
        type,
        dir,
        r,
        c1,
        c2,
        c3,
        atm,
        axis: norm([rnd(-0.35, 0.35), 1, rnd(-0.35, 0.35)]),
        spin: rnd(0.015, 0.06),
        ring: ring ? [rnd(1.25, 1.6), rnd(1.9, 2.7), rnd(0.5, 0.9), 1] : [0, 0, 0, 0],
        ringN: norm([rnd(-0.25, 0.25), 1, rnd(-0.7, 0.7)]),
        ringC: hsl(hue + rnd(-0.05, 0.05), rnd(0.15, 0.35), rnd(0.6, 0.8)),
        moon: moon ? [...mdir, r * rnd(0.12, 0.3)] : [0, 0, 1, 0],
        sun,
        sunVis: backlit ? 0 : 1,
      };
    }

    // ---------------------------------------------------------------- the ship's story
    const WARP = 240; // units per second
    const IMPULSE = 3;
    let neb = NEB[Math.floor(Math.random() * NEB.length)];
    let gal = norm([rnd(-1, 1), rnd(-1, 1), rnd(-0.5, 0.5)]);
    let planet = null;
    let seed = rnd(0, 50);
    let mode = 'warp';
    let modeAt = 0;
    let modeLen = 0;
    let nextDrop = 0;
    let dist = rnd(0, 10000);
    let speed = WARP;
    let exposure = 0.05;
    let warpAmt = 1;
    let flash = 0;
    let shake = 0;
    let ringAt = -99;
    let planetAmt = 0;
    let planetT0 = 0;
    let prevBeat = 0;
    let started = false;
    let sideBias = 1; // which way the other displays are
    let room = [1, 1]; // picture to the left / right of the course (in picture heights)
    let yaw = 0;
    let pitch = 0;
    let roll = 0;

    function setMode(m, t) {
      mode = m;
      modeAt = t;
      if (m === 'drop') {
        modeLen = 2.4;
        flash = Math.max(flash, 0.3);
        // the new planet is generated now, so it's waiting as the stars slow down
        let side = Math.random() < 0.75 ? sideBias : -sideBias;
        if (room[side > 0 ? 1 : 0] < 0.9) side = -side; // not enough picture on that side
        planet = makePlanet(side, room[side > 0 ? 1 : 0]);
        planetT0 = t;
        seed = rnd(0, 50);
      } else if (m === 'impulse') {
        modeLen = rnd(8, 15);
      } else if (m === 'engage') {
        modeLen = 1.7;
      } else if (m === 'warp') {
        nextDrop = t + rnd(70, 150);
        neb = NEB[Math.floor(Math.random() * NEB.length)];
        gal = norm([rnd(-1, 1), rnd(-1, 1), rnd(-0.5, 0.5)]);
      }
    }

    function rotation() {
      // ship orientation: yaw (turn), pitch, roll — as a 3x3 matrix, ship -> view
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
      const Ry = [[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]];
      const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
      const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
      const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
      return mul(Rz, mul(Rx, Ry));
    }
    const colMajor = (R) => new Float32Array([R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]]);
    const rowMajor = (R) => new Float32Array([R[0][0], R[0][1], R[0][2], R[1][0], R[1][1], R[1][2], R[2][0], R[2][1], R[2][2]]);

    return {
      resize(w, h) {
        post.resize(w, h);
      },
      render(f) {
        const t = f.time;
        const dt = Math.min(f.dt, 1 / 20);
        const au = f.audio;
        sideBias = f.total[0] - f.focus[0] >= f.focus[0] ? 1 : -1;
        room = [f.focus[0] / f.total[1], (f.total[0] - f.focus[0]) / f.total[1]];
        if (!started) {
          started = true;
          setMode('warp', t);
          if (window.WARP_DROP) nextDrop = t; // test hook: drop out right away
        }

        // ---- story: warp -> drop out -> impulse beside a planet -> engage -> warp
        const clicked = f.clicks.length > 0;
        const u = (t - modeAt) / modeLen;
        if (mode === 'warp' && (clicked || t > nextDrop || t < nextDrop - 400)) setMode('drop', t);
        else if (mode === 'drop' && u >= 1) setMode('impulse', t);
        else if (mode === 'impulse' && (clicked || u >= 1)) setMode('engage', t);
        else if (mode === 'engage' && u >= 1) setMode('warp', t);
        const uu = Math.max(0, Math.min(1, (t - modeAt) / (modeLen || 1)));
        let targetSpeed = WARP;
        let targetExp = 0.05;
        let targetWarp = 1;
        if (mode === 'drop') {
          const e = 1 - Math.pow(1 - uu, 3);
          targetSpeed = WARP + (IMPULSE - WARP) * e;
          targetWarp = 1 - e;
        } else if (mode === 'impulse') {
          targetSpeed = IMPULSE;
          targetWarp = 0;
        } else if (mode === 'engage') {
          // the stars stretch... then the jump
          if (uu < 0.65) {
            const s = uu / 0.65;
            targetSpeed = IMPULSE + 30 * s * s;
            targetExp = 0.05 + 0.9 * s * s;
            targetWarp = 0.3 * s;
            shake = Math.max(shake, 0.25 * s);
          } else {
            if (flash < 0.9 && t - ringAt > 1) {
              flash = 1.4;
              ringAt = t;
              shake = 1;
            }
            targetSpeed = WARP * 1.7;
            targetWarp = 1;
          }
        } else {
          targetSpeed = WARP * (1 + au.bass * 0.35);
        }
        if (au.beat > prevBeat + 0.5 && mode === 'warp') {
          flash = Math.max(flash, 0.08 + au.bass * 0.1);
          if (Math.random() < 0.35) ringAt = t;
        }
        prevBeat = au.beat;
        const k = 1 - Math.exp(-dt * (mode === 'engage' ? 10 : 3));
        speed += (targetSpeed - speed) * k;
        exposure += (targetExp - exposure) * (1 - Math.exp(-dt * 8));
        warpAmt += (targetWarp - warpAmt) * (1 - Math.exp(-dt * 2.5));
        planetAmt += ((mode === 'impulse' || (mode === 'drop' && uu > 0.45) ? 1 : 0) - planetAmt) * (1 - Math.exp(-dt * (mode === 'engage' ? 6 : 1.2)));
        flash *= Math.exp(-dt * 2.2);
        shake *= Math.exp(-dt * 3);
        dist += speed * dt;

        // ---- the pointer steers the ship; a slow drift and bank otherwise; a shudder on engage
        const tyaw = f.look[0] * 0.22 + Math.sin(t * 0.031) * 0.03;
        const tpitch = -f.look[1] * 0.14 + Math.sin(t * 0.023 + 1) * 0.02;
        yaw += (tyaw - yaw) * (1 - Math.exp(-dt * 1.5));
        pitch += (tpitch - pitch) * (1 - Math.exp(-dt * 1.5));
        roll += (-yaw * 0.35 + Math.sin(t * 0.017) * 0.03 - roll) * (1 - Math.exp(-dt * 1.2));
        const jit = shake * 0.012 + warpAmt * 0.0006;
        const syaw = yaw;
        const spitch = pitch;
        yaw += Math.sin(t * 53.0) * jit;
        pitch += Math.sin(t * 61.0 + 1.3) * jit;
        const R = rotation();
        yaw = syaw;
        pitch = spitch;
        const H = f.total[1];
        const ringAge = t - ringAt;
        const P = planet;

        // ---- space (and the planet system)
        G.draw(bgP, post.target, (p) => {
          G.common(p, f);
          gl.uniform2f(p.u('uVP'), f.focus[0], f.focus[1]);
          gl.uniform1f(p.u('uFovk'), FOVK);
          gl.uniform1f(p.u('uDist'), dist % 5e6);
          gl.uniform1f(p.u('uWarp'), warpAmt);
          gl.uniform1f(p.u('uFlash'), flash);
          gl.uniform1f(p.u('uRing'), ringAge * 1.4);
          gl.uniform1f(p.u('uRingA'), ringAge >= 0 && ringAge < 1.5 ? 0.8 * (1 - ringAge / 1.5) : 0);
          gl.uniformMatrix3fv(p.u('uRotT'), false, rowMajor(R));
          gl.uniform3fv(p.u('uNebA'), neb[0]);
          gl.uniform3fv(p.u('uNebB'), neb[1]);
          gl.uniform3fv(p.u('uGal'), gal);
          gl.uniform1f(p.u('uSeed'), seed);
          gl.uniform1f(p.u('uPlanet'), P ? planetAmt : 0);
          if (P) {
            gl.uniform4f(p.u('uPl'), P.dir[0], P.dir[1], P.dir[2], P.r);
            gl.uniform1f(p.u('uPlType'), P.type);
            gl.uniform3fv(p.u('uPlC1'), P.c1);
            gl.uniform3fv(p.u('uPlC2'), P.c2);
            gl.uniform3fv(p.u('uPlC3'), P.c3);
            gl.uniform3fv(p.u('uPlAtm'), P.atm);
            gl.uniform3fv(p.u('uSun'), P.sun);
            gl.uniform1f(p.u('uSunVis'), P.sunVis);
            gl.uniform4f(p.u('uPlAx'), P.axis[0], P.axis[1], P.axis[2], (t - planetT0) * P.spin);
            gl.uniform4fv(p.u('uRingP'), P.ring);
            gl.uniform3fv(p.u('uRingN'), P.ringN);
            gl.uniform3fv(p.u('uRingC'), P.ringC);
            gl.uniform4fv(p.u('uMoon'), P.moon);
          }
        });

        // ---- stars
        gl.useProgram(starP.p);
        gl.bindVertexArray(emptyVao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, post.target.fb);
        gl.viewport(0, 0, post.target.w, post.target.h);
        gl.uniform2f(starP.u('uFrame'), f.width, f.height);
        gl.uniform2f(starP.u('uVP'), f.focus[0] * f.scale, f.focus[1] * f.scale);
        gl.uniform1f(starP.u('uPx'), (H / FOVK) * f.scale);
        gl.uniformMatrix3fv(starP.u('uRot'), false, colMajor(R));
        gl.uniform1f(starP.u('uWarp'), warpAmt);
        gl.uniform1f(starP.u('uPlanet'), P ? planetAmt : 0);
        if (P) gl.uniform4f(starP.u('uPl'), P.dir[0], P.dir[1], P.dir[2], P.r);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        const sc = Math.max(0.6, f.height / 1080);
        LAYERS.forEach((L, i) => {
          gl.uniform1f(starP.u('uLayer'), i);
          // wrapped by whole cycles (keeps float precision over hours of flying)
          gl.uniform1f(starP.u('uDist'), (dist * L.k) % ((L.far - L.near) * 1000));
          gl.uniform1f(starP.u('uStreak'), speed * L.k * exposure);
          gl.uniform1f(starP.u('uNear'), L.near);
          gl.uniform1f(starP.u('uFar'), L.far);
          gl.uniform1f(starP.u('uRMin'), L.rMin);
          gl.uniform1f(starP.u('uRMax'), L.rMax);
          gl.uniform1f(starP.u('uWidth'), L.w * sc);
          gl.uniform1f(starP.u('uOnlyWarp'), L.onlyWarp || 0);
          gl.uniform1f(starP.u('uBright'), L.b * (1.1 + warpAmt * 0.4 + flash * 0.6 + au.treble * 0.3));
          gl.drawArrays(gl.TRIANGLES, 0, L.n * 6);
        });
        gl.disable(gl.BLEND);

        post.run(f);
      },
      dispose() {
        post.dispose();
        [bgP, starP].forEach((p) => gl.deleteProgram(p.p));
        gl.deleteVertexArray(emptyVao);
      },
    };
  },
});
