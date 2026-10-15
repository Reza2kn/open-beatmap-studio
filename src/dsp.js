const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
    }
  }
  for (let width = 2; width <= n; width <<= 1) {
    const angle = (-2 * Math.PI) / width;
    const wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let start = 0; start < n; start += width) {
      let r = 1,
        im = 0;
      for (let k = 0; k < width / 2; k++) {
        const a = start + k,
          b = a + width / 2;
        const tr = r * real[b] - im * imag[b],
          ti = r * imag[b] + im * real[b];
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;
        real[a] += tr;
        imag[a] += ti;
        const next = r * wr - im * wi;
        im = r * wi + im * wr;
        r = next;
      }
    }
  }
}

/** Pick distinct transients using a local adaptive threshold, not an absolute loudness gate. */
export function pickOnsets(envelope, frameDuration) {
  if (!(frameDuration > 0)) throw new Error("Frame duration must be positive.");
  let peak = 0;
  for (const value of envelope) peak = Math.max(peak, value);
  if (peak < 1e-9) return [];
  const out = [],
    radius = Math.max(3, Math.round(0.2 / frameDuration));
  const prefix = new Float64Array(envelope.length + 1);
  for (let i = 0; i < envelope.length; i++)
    prefix[i + 1] = prefix[i] + envelope[i];
  for (let i = 0; i < envelope.length; i++) {
    const a = Math.max(0, i - radius),
      b = Math.min(envelope.length, i + radius + 1);
    const local = (prefix[b] - prefix[a]) / (b - a);
    if (envelope[i] < Math.max(peak * 0.035, local * 1.45)) continue;
    if (
      envelope[i] < (envelope[i - 1] || 0) ||
      envelope[i] <= (envelope[i + 1] || 0)
    )
      continue;
    const candidate = {
      time: i * frameDuration,
      strength: clamp(envelope[i] / peak, 0, 1),
      frame: i,
    };
    if (out.length && candidate.time - out.at(-1).time < 0.085) {
      if (candidate.strength > out.at(-1).strength)
        out[out.length - 1] = candidate;
    } else out.push(candidate);
  }
  return out;
}

/** Refine centered FFT peaks to the physical energy-rise edge, locally only. */
export function refineOnsetTimes(samples, sampleRate, onsets) {
  return onsets
    .map((onset) => {
      const first = Math.max(0, Math.floor((onset.time - 0.025) * sampleRate));
      const last = Math.min(
        samples.length,
        Math.ceil((onset.time + 0.07) * sampleRate),
      );
      const prefix = new Float64Array(last - first + 1);
      for (let i = first; i < last; i++)
        prefix[i - first + 1] = prefix[i - first] + samples[i] ** 2;
      const width = Math.max(2, Math.round(0.004 * sampleRate)),
        delay = Math.max(width, Math.round(0.012 * sampleRate));
      const stride = Math.max(1, Math.round(0.001 * sampleRate));
      const energy = (i) =>
        (prefix[Math.min(prefix.length - 1, i + width)] -
          prefix[Math.max(0, i)]) /
        width;
      const slopes = [];
      for (let i = delay; i + width < prefix.length; i += stride)
        slopes.push({ i, rise: Math.max(0, energy(i) - energy(i - delay)) });
      let peak = 0;
      for (let i = 1; i < slopes.length; i++)
        if (slopes[i].rise > slopes[peak].rise) peak = i;
      if (!slopes[peak] || slopes[peak].rise < 1e-10) return { ...onset };
      const threshold = slopes[peak].rise * 0.18;
      let edge = peak;
      while (edge > 0 && slopes[edge - 1].rise > threshold) edge--;
      const time = (first + slopes[edge].i) / sampleRate;
      return { ...onset, time, spectralTime: onset.time };
    })
    .sort((a, b) => a.time - b.time);
}

