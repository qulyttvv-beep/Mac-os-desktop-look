// Music reactivity: the helper process listens to what the PC is playing (WASAPI loopback,
// nothing is recorded or sent anywhere) and sends raw bass / mid / treble levels ~30×/s.
// This turns them into what the scenes use: levels that react the same at any volume,
// plus a beat flag.
window.AudioReact = (() => {
  const peak = { bass: 0.15, mid: 0.15, treble: 0.15 };
  let avgBass = 0.05;
  let lastBeat = 0;

  function process(raw) {
    const loud = (raw.bass + raw.mid + raw.treble) / 3;
    const out = { bass: 0, mid: 0, treble: 0, level: 0, beat: false };
    if (loud > 0.015) {
      // adaptive gain: react the same at low and high volume
      for (const k of ['bass', 'mid', 'treble']) {
        peak[k] = Math.max(peak[k] * 0.996, raw[k], 0.06);
        out[k] = Math.min(1, raw[k] / peak[k]);
      }
      out.level = (out.bass + out.mid + out.treble) / 3;
      const now = performance.now();
      if (raw.bass > avgBass * 1.32 && raw.bass > 0.2 && now - lastBeat > 260) {
        out.beat = true;
        lastBeat = now;
      }
    }
    avgBass = avgBass * 0.94 + raw.bass * 0.06;
    return out;
  }

  return { process };
})();
