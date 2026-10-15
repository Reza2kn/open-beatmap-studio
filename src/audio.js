import { fft, pickOnsets, refineOnsetTimes } from "./dsp.js";
import { extractPercussion } from "./percussion.js";
/** Local, dependency-free musical feature extraction. Times refer to the supplied (trimmed) buffer. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mean = (values) =>
  values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const yieldUI = () => new Promise((resolve) => setTimeout(resolve, 0));

export { pickOnsets, refineOnsetTimes } from "./dsp.js";

function phaseFit(onsets, bpm, liftPhase = false) {
  const period = 60 / bpm;
  let x = 0,
    y = 0,
    x2 = 0,
    y2 = 0,
    weight = 0;
  for (const onset of onsets) {
    const angle = (onset.time / period) * 2 * Math.PI;
    const w = Math.sqrt(onset.strength);
    x += Math.cos(angle) * w;
    y += Math.sin(angle) * w;
    x2 += Math.cos(2 * angle) * w;
    y2 += Math.sin(2 * angle) * w;
    weight += w;
  }
  // A strong eighth-note pulse should retain a half-time alternative instead of a random phase.
  const harmonic = Math.hypot(x2, y2) * 0.92 > Math.hypot(x, y) ? 2 : 1;
  const phasePeriod = period / harmonic;
  const angle = harmonic === 2 ? Math.atan2(y2, x2) : Math.atan2(y, x);
  let offset =
    ((((angle / (2 * Math.PI)) * phasePeriod) % phasePeriod) + phasePeriod) %
    phasePeriod;
  if (harmonic === 2 && liftPhase) {
    // The second harmonic identifies TWO phase branches. Returning only the
    // first modulo-half-period branch can move the entire map off the drums.
    const support = (phase) =>
      onsets.reduce((sum, onset) => {
        const distance = Math.abs(
          ((((onset.time - phase + period / 2) % period) + period) % period) -
            period / 2,
        );
        return (
          sum +
          onset.strength ** 1.5 *
            (0.2 + 0.8 * (onset.low ?? 1) ** 2) *
            Math.exp(-0.5 * (distance / Math.min(0.04, period * 0.12)) ** 2)
        );
      }, 0);
    if (support(offset + phasePeriod) > support(offset)) offset += phasePeriod;
  }
  return {
    coherence:
      (harmonic === 2 ? Math.hypot(x2, y2) * 0.92 : Math.hypot(x, y)) /
      Math.max(1e-9, weight),
    offset,
  };
}

/** Autocorrelation + onset phase refinement. Confidence is a heuristic, not a calibrated probability. */
export function estimateTempo(
  envelope,
  frameDuration,
  onsets = pickOnsets(envelope, frameDuration),
) {
  if (onsets.length < 4)
    return {
      bpm: 120,
      offset: onsets[0]?.time || 0,
      confidence: 0,
      tempoCandidates: [],
    };
  const minLag = Math.floor(60 / 200 / frameDuration),
    maxLag = Math.ceil(60 / 55 / frameDuration);
  const avg = mean(envelope);
  const centered = Float64Array.from(envelope, (value) =>
    Math.max(0, value - avg),
  );
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0,
      normA = 0,
      normB = 0;
    // Limit very long recordings to a uniform sample of frames.
    const stride = Math.max(1, Math.floor(centered.length / 30000));
    for (let i = lag; i < centered.length; i += stride) {
      sum += centered[i] * centered[i - lag];
      normA += centered[i] ** 2;
      normB += centered[i - lag] ** 2;
    }
    const bpm = 60 / (lag * frameDuration);
    const correlation = sum / Math.max(1e-12, Math.sqrt(normA * normB));
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 1.3) ** 2);
    scores.push({
      bpm,
      lag,
      correlation,
      score: correlation * (0.8 + 0.2 * prior),
    });
  }
  const local = scores.filter(
    (s, i) =>
      s.score >= (scores[i - 1]?.score || 0) &&
      s.score >= (scores[i + 1]?.score || 0),
  );
  local.sort((a, b) => b.score - a.score);
  const candidates = local.slice(0, 5);
  if (!candidates.length || candidates[0].score < 0.02)
    return {
      bpm: 120,
      offset: onsets[0].time,
      confidence: 0,
      tempoCandidates: [],
    };
  // Whole-track phase coherence resolves sub-frame BPM precision, avoiding accumulated grid drift.
  const sampled =
    onsets.length > 3000
      ? onsets.filter((_, i) => i % Math.ceil(onsets.length / 3000) === 0)
      : onsets;
  const refined = candidates
    .map((candidate) => {
      let best = { coherence: -1, bpm: candidate.bpm, offset: 0 };
      const radius = Math.max(1.5, candidate.bpm * 0.018);
      for (
        let bpm = Math.max(55, candidate.bpm - radius);
        bpm <= Math.min(200, candidate.bpm + radius);
        bpm += 0.04
      ) {
        const fit = phaseFit(sampled, bpm);
        if (fit.coherence > best.coherence) best = { ...fit, bpm };
      }
      // Coarse 0.04 BPM steps accumulate audible drift over a full song.
      const coarse = best.bpm;
      for (let bpm = coarse - 0.04; bpm <= coarse + 0.04; bpm += 0.001) {
        if (bpm < 55 || bpm > 200) continue;
        const fit = phaseFit(sampled, bpm);
        if (fit.coherence > best.coherence) best = { ...fit, bpm };
      }
      return {
        ...candidate,
        ...best,
        score: candidate.score * 0.65 + best.coherence * 0.35,
      };
    })
    .sort((a, b) => b.score - a.score);
  let best = refined[0];
  // When both octaves explain the audio almost equally, prefer the slower
  // human pulse instead of allowing resampling noise to flip tempo and phase.
  const half = refined.find(
    (c) =>
      Math.abs((c.bpm * 2) / best.bpm - 1) < 0.015 &&
      c.score >= best.score * 0.95,
  );
  if (best.bpm > 145 && half) best = half;
  best = { ...best, ...phaseFit(sampled, best.bpm, true) };
  // Half/double candidates can be equally plausible. Expose alternatives and reduce confidence.
  const runnerUp = refined.find(
    (candidate) => Math.abs(Math.log2(candidate.bpm / best.bpm)) > 0.15,
  );
  const ambiguity = runnerUp
    ? clamp((best.score - runnerUp.score) / Math.max(best.score, 0.01), 0, 1)
    : 1;
  const confidence = clamp(
    (0.6 * best.correlation + 0.4 * best.coherence) * (0.55 + 0.45 * ambiguity),
    0,
    1,
  );
  return {
    bpm: Math.round(best.bpm * 1000) / 1000,
    offset: best.offset,
    confidence,
    tempoCandidates: refined
      .slice(0, 3)
      .map((c) => ({ bpm: Math.round(c.bpm * 1000) / 1000, score: c.score })),
  };
}

export function detectSections(energy, frameDuration, bpm, duration) {
  if (!energy.length || duration <= 0) return [];
  const phrase = Math.max(2, (16 * 60) / bpm),
    count = Math.ceil(duration / phrase);
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const start = i * phrase,
      end = Math.min(duration, (i + 1) * phrase);
    const values = energy.slice(
      Math.floor(start / frameDuration),
      Math.max(
        Math.floor(start / frameDuration) + 1,
        Math.ceil(end / frameDuration),
      ),
    );
    blocks.push({ start, end, energy: mean(values), label: "flow" });
  }
  const avg = mean(blocks.map((s) => s.energy));
  blocks.forEach((section, i) => {
    const previous = blocks[i - 1]?.energy ?? section.energy;
    section.label =
      section.energy < Math.max(0.06, avg * 0.65)
        ? "quiet"
        : section.energy > avg * 1.25
          ? "peak"
          : section.energy > previous * 1.3
            ? "build"
            : "flow";
  });
  return blocks;
}

/**
 * @param {AudioBuffer} buffer decoded or trimmed browser AudioBuffer
 * @returns All event times/section boundaries in seconds. No network or model required.
 */
export async function analyzeAudio(
  buffer,
  { bpmOverride, offsetOverride } = {},
) {
  if (
    !buffer ||
    !(buffer.sampleRate > 0) ||
    !buffer.length ||
    !buffer.numberOfChannels
  )
    throw new Error("Load a non-empty audio file first.");
  if (
    bpmOverride != null &&
    (!Number.isFinite(Number(bpmOverride)) ||
      Number(bpmOverride) < 30 ||
      Number(bpmOverride) > 300)
  )
    throw new Error("BPM must be between 30 and 300.");
  if (
    offsetOverride != null &&
    (!Number.isFinite(Number(offsetOverride)) ||
      Math.abs(Number(offsetOverride)) > 60)
  )
    throw new Error("Beat offset must be between −60 and 60 seconds.");
  const rate = Math.min(11025, buffer.sampleRate),
    ratio = buffer.sampleRate / rate;
  const length = Math.ceil(buffer.length / ratio),
    mono = new Float32Array(length);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  // Box-filter each output interval before decimation; preserve input samples for export elsewhere.
  for (let i = 0; i < length; i++) {
    let sum = 0,
      count = 0;
    const start = Math.floor(i * ratio),
      end = Math.min(
        buffer.length,
        Math.max(start + 1, Math.floor((i + 1) * ratio)),
      );
    for (let j = start; j < end; j++)
      for (const channel of channels) {
        sum += Number.isFinite(channel[j]) ? channel[j] : 0;
        count++;
      }
    mono[i] = sum / count;
    if (i && i % 150000 === 0) await yieldUI();
  }
  let monoPeak = 0;
  for (const v of mono) monoPeak = Math.max(monoPeak, Math.abs(v));
  if (monoPeak > 1e-7)
    for (let i = 0; i < mono.length; i++) mono[i] /= monoPeak;
  const n = 1024,
    hop = 128,
    frameDuration = hop / rate,
    frames = Math.ceil(length / hop);
  const window = Float32Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  );
  const re = new Float64Array(n),
    im = new Float64Array(n),
    previous = new Float32Array(n / 2);
  const envelope = new Float32Array(frames),
    rms = new Float32Array(frames),
    bands = [];
  const spectra = new Float32Array(frames * (n / 2));
  let maxRms = 0;
  for (let frame = 0; frame < frames; frame++) {
    const center = frame * hop;
    let square = 0;
    im.fill(0);
    for (let j = 0; j < n; j++) {
      const value = mono[center + j - n / 2] || 0;
      re[j] = value * window[j];
      square += value * value;
    }
    rms[frame] = Math.sqrt(square / n);
    maxRms = Math.max(maxRms, rms[frame]);
    fft(re, im);
    let low = 0,
      mid = 0,
      high = 0;
    for (let k = 3; k < n / 2; k++) {
      const amplitude = Math.hypot(re[k], im[k]);
      spectra[frame * (n / 2) + k] = amplitude;
      const magnitude = Math.log1p((40 * amplitude) / n);
      const delta = Math.max(0, magnitude - previous[k]);
      previous[k] = magnitude;
      const hz = (k * rate) / n;
      if (hz < 250) low += delta;
      else if (hz < 2000) mid += delta;
      else high += delta;
    }
    // Per-band averaging prevents the many treble bins from drowning out kick transients.
    low /= Math.max(1, (250 * n) / rate - 3);
    mid /= (1750 * n) / rate;
    high /= Math.max(1, n / 2 - (2000 * n) / rate);
    envelope[frame] = low * 0.45 + mid * 0.35 + high * 0.2;
    bands.push([low, mid, high]);
    if (frame && frame % 160 === 0) await yieldUI();
  }
  const picked = refineOnsetTimes(
    mono,
    rate,
    pickOnsets(envelope, frameDuration),
  ).map((onset) => {
    const [low, mid, high] = bands[onset.frame],
      total = low + mid + high || 1;
    return { ...onset, low: low / total, mid: mid / total, high: high / total };
  });
  await yieldUI();
  const tempo = estimateTempo(envelope, frameDuration, picked);
  const bpm = bpmOverride != null ? Number(bpmOverride) : tempo.bpm;
  const fitted = bpmOverride != null ? phaseFit(picked, bpm, true) : tempo;
  let offset = offsetOverride != null ? Number(offsetOverride) : fitted.offset;
  // A phase just before the first beat is represented as a small negative offset.
  if (offsetOverride == null && offset > (60 / bpm) * 0.85) offset -= 60 / bpm;
  const duration = buffer.duration || buffer.length / buffer.sampleRate;
  const energy = Array.from(rms, (v) => (maxRms > 1e-8 ? v / maxRms : 0));
  const waveform = Array.from({ length: 800 }, (_, bin) => {
    let peak = 0;
    for (
      let i = Math.floor((bin * length) / 800);
      i < Math.ceil(((bin + 1) * length) / 800);
      i++
    )
      peak = Math.max(peak, Math.abs(mono[i] || 0));
    return peak;
  });
  let waveformPeak = 0;
  for (const value of waveform) waveformPeak = Math.max(waveformPeak, value);
  if (waveformPeak)
    for (let i = 0; i < waveform.length; i++) waveform[i] /= waveformPeak;
  const onsets = picked.map(({ frame, ...onset }) => {
    const [low, mid, high] = bands[frame],
      total = low + mid + high || 1;
    return { ...onset, low: low / total, mid: mid / total, high: high / total };
  });
  const separated = await extractPercussion(mono, rate, spectra, n, hop);
  // Harmonic masks smear a piano's leading edge. Use the nearby full-signal
  // physical attack to refine it, while retaining separated harmonic evidence.
  separated.melodicEvents = separated.melodicEvents.map(event => {
    const nearest = onsets.reduce((best, onset) => Math.abs(onset.time-event.time)<Math.abs(best.time-event.time)?onset:best, {time:Infinity});
    return Math.abs(nearest.time-event.time)<.08 ? {...event,time:nearest.time} : event;
  }).sort((a,b)=>a.time-b.time);
  const rhythmEvents = onsets.map((onset) => {
    const kind =
      onset.low > 0.55
        ? "kick"
        : onset.high > 0.35
          ? "high"
          : onset.mid > 0.4
            ? "snare"
            : "mid";
    const beat = ((onset.time - offset) * bpm) / 60;
    return {
      ...onset,
      beat,
      gridBeat: Math.round(beat * 4) / 4,
      gridError: ((beat - Math.round(beat * 4) / 4) * 60) / bpm,
      confidence: clamp(Math.sqrt(onset.strength), 0, 1),
      kind,
      source: "acoustic",
    };
  });
  const beatTimes = [];
  if (maxRms > 1e-8)
    for (
      let time =
        offset + (Math.max(0, Math.ceil((-offset * bpm) / 60)) * 60) / bpm;
      time < duration;
      time += 60 / bpm
    )
      beatTimes.push(time);
  return {
    bpm,
    offset,
    duration,
    confidence: tempo.confidence,
    onsets,
    rhythmEvents,
    ...separated,
    sections: detectSections(energy, frameDuration, bpm, duration),
    waveform,
    energy,
    beatTimes,
    frameDuration,
    tempoCandidates: tempo.tempoCandidates,
    method: "attack-refined-spectral-flux",
    silent: maxRms < 1e-8,
  };
}

/** Changing the analytical grid must not quantize observed attack timestamps. */
export function retimeAnalysis(analysis, bpm, offset) {
  const beatTimes = [];
  if (bpm > 0 && Number.isFinite(offset) && !analysis.silent) {
    for (
      let b = Math.ceil((-offset * bpm) / 60);
      offset + (b * 60) / bpm < analysis.duration;
      b++
    )
      beatTimes.push(offset + (b * 60) / bpm);
  }
  return {
    ...analysis,
    bpm,
    offset,
    beatTimes,
    rhythmEvents: analysis.rhythmEvents?.map((e) => {
      const beat = ((e.time - offset) * bpm) / 60,
        gridBeat = Math.round(beat * 4) / 4;
      return {
        ...e,
        beat,
        gridBeat,
        gridError: ((beat - gridBeat) * 60) / bpm,
      };
    }),
    sections: detectSections(
      analysis.energy,
      analysis.frameDuration,
      bpm,
      analysis.duration,
    ),
  };
}
