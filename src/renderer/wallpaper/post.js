// Photographic post-processing shared by the scenes:
//   depth of field  — scenes write a per-pixel blur radius (canvas px) into the HDR alpha
//                     channel; a golden-angle gather blurs with it without letting sharp
//                     foreground bleed into the out-of-focus background,
//   bloom           — highlights glow through a small blur pyramid,
//   finish          — faint lens chromatic aberration, colour grade, tone map, grain.
window.WallPost = {
  create(G, opts = {}) {
    const { gl } = G;
    const o = Object.assign({ threshold: [1.2, 4.0], bloom: 0.2, ca: 0.0014, exposure: 1, vignette: 0.65, warm: 0.02 }, opts);

    const dofP = G.program(`
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
void main() {
  vec4 c0 = texture(uSrc, vUv);
  float r0 = c0.a;
  if (r0 < 0.6) { outColor = vec4(c0.rgb, 0.0); return; }
  vec3 acc = c0.rgb;
  float wsum = 1.0;
  const int N = 22;
  for (int i = 1; i <= N; i++) {
    float fi = float(i);
    float rr = sqrt(fi / float(N)) * r0;
    float a = fi * 2.39996323;
    vec4 s = texture(uSrc, vUv + vec2(cos(a), sin(a)) * rr * uTexel);
    float w = smoothstep(rr - 0.75, rr + 0.25, s.a);   // only samples blurry enough to reach here (no halos)
    acc += s.rgb * w;
    wsum += w;
  }
  outColor = vec4(acc / wsum, 0.0);
}`);
    const prefilterP = G.program(`
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uKnee;
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  float br = max(c.r, max(c.g, c.b));
  outColor = vec4(c * smoothstep(uKnee.x, uKnee.y, br), 1.0);
}`);
    const blurP = G.program(`
in vec2 vUv;
uniform sampler2D uTex; uniform vec2 uTexel;
void main() {
  vec4 s = texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, -1.0))
         + texture(uTex, vUv + uTexel * vec2(-1.0, 1.0)) + texture(uTex, vUv + uTexel * vec2(1.0, 1.0));
  outColor = s * 0.25;
}`);
    const finalP = G.program(`
in vec2 vUv;
uniform sampler2D uImg, uBloom;
uniform float uBloomAmt, uCA, uExposure, uVig, uWarm;
void main() {
  vec2 d = (vUv - 0.5);
  vec2 off = d * uCA;
  vec3 c = vec3(texture(uImg, vUv + off).r, texture(uImg, vUv).g, texture(uImg, vUv - off).b);
  vec3 b = texture(uBloom, vUv).rgb;
  c += b * uBloomAmt + b * vec3(0.06, 0.0, -0.02) * uBloomAmt;   // slightly warm halation
  c *= uExposure;
  c = pow(max(c, 0.0), vec3(1.0 + uWarm, 1.0, 1.0 - uWarm));     // cool shadows, warm highlights
  outColor = vec4(finish(c, uVig), 1.0);
}`);

    let hdr = null;
    let sharp = null;
    let bloom = [];
    const api = {
      get target() {
        return hdr;
      },
      resize(w, h) {
        [hdr, sharp, ...bloom].forEach((b) => b && b.dispose());
        // external: the scene keeps its own picture and passes it to run()
        hdr = o.external ? null : G.fbo(w, h);
        // scenes without depth of field (dof: false) skip this copy and its buffer
        sharp = o.dof === false ? null : G.fbo(w, h);
        bloom = [];
        let bw = w >> 1;
        let bh = h >> 1;
        for (let i = 0; i < 6 && bw > 4 && bh > 4; i++, bw >>= 1, bh >>= 1) bloom.push(G.fbo(bw, bh));
      },
      run(f, src) {
        const S = src || hdr;
        const img = sharp || S;
        if (sharp) {
          G.draw(dofP, sharp, (p) => {
            gl.uniform1i(p.u('uSrc'), S.attach(0));
            gl.uniform2f(p.u('uTexel'), S.texel[0], S.texel[1]);
          });
        }
        if (bloom.length) {
          G.draw(prefilterP, bloom[0], (p) => {
            gl.uniform1i(p.u('uTex'), img.attach(0));
            gl.uniform2f(p.u('uKnee'), o.threshold[0], o.threshold[1]);
          });
          for (let i = 1; i < bloom.length; i++) {
            G.draw(blurP, bloom[i], (p) => {
              gl.uniform2f(p.u('uTexel'), bloom[i - 1].texel[0], bloom[i - 1].texel[1]);
              gl.uniform1i(p.u('uTex'), bloom[i - 1].attach(0));
            });
          }
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.ONE, gl.ONE);
          for (let i = bloom.length - 2; i >= 0; i--) {
            G.draw(blurP, bloom[i], (p) => {
              gl.uniform2f(p.u('uTexel'), bloom[i + 1].texel[0], bloom[i + 1].texel[1]);
              gl.uniform1i(p.u('uTex'), bloom[i + 1].attach(0));
            });
          }
          gl.disable(gl.BLEND);
        }
        G.draw(finalP, null, (p) => {
          G.common(p, f);
          gl.uniform1i(p.u('uImg'), img.attach(0));
          gl.uniform1i(p.u('uBloom'), (bloom[0] || img).attach(1));
          gl.uniform1f(p.u('uBloomAmt'), bloom.length ? o.bloom : 0);
          gl.uniform1f(p.u('uCA'), o.ca);
          gl.uniform1f(p.u('uExposure'), o.exposure);
          gl.uniform1f(p.u('uVig'), o.vignette);
          gl.uniform1f(p.u('uWarm'), o.warm);
        });
      },
      dispose() {
        [hdr, sharp, ...bloom].forEach((b) => b && b.dispose());
        [dofP, prefilterP, blurP, finalP].forEach((p) => gl.deleteProgram(p.p));
      },
    };
    return api;
  },
};
