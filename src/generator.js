/**
 * Seeded, local choreography. Time in the public map schema is always beats;
 * audio features are seconds. No network, model weights, or global RNG needed.
 */
export const DIFFICULTIES = Object.freeze([
  "Easy",
  "Normal",
  "Hard",
  "Expert",
  "ExpertPlus",
]);

// Calibration starts with the former Hard groove rather than a two-hit bar.
// Detail stages admit evidence already produced by the audio pipeline; none
// of these profiles synthesize extra timestamps to meet a note-count target.
const PROFILES = {
  Easy: { rank: 1, handGap: .28, gap: .14, njs: 14, motion: 2,
    detailBudget: 4, tonalFillBudget: 0, finePercussion: false, fineMelody: 'none', instrumentFillStrength: Infinity,
    drumFillDensity: Infinity, doubleEveryBars: 4 },
  Normal: { rank: 3, handGap: .24, gap: .12, njs: 15, motion: 3,
    detailBudget: 8, tonalFillBudget: 2, finePercussion: false, fineMelody: 'none', instrumentFillStrength: .12,
    drumFillDensity: .85, doubleEveryBars: 2 },
  Hard: { rank: 5, handGap: .18, gap: .09, njs: 16, motion: 4,
    detailBudget: 12, tonalFillBudget: 4, finePercussion: false, fineMelody: 'recurring', instrumentFillStrength: .08,
    drumFillDensity: .65, doubleEveryBars: 1 },
  Expert: { rank: 7, handGap: .16, gap: .08, njs: 17, motion: 5,
    detailBudget: 16, tonalFillBudget: 8, finePercussion: true, fineMelody: 'strong', instrumentFillStrength: .05,
    drumFillDensity: .45, doubleEveryBars: 1 },
  ExpertPlus: { rank: 9, handGap: .14, gap: .065, njs: 18, motion: 6,
    detailBudget: 24, tonalFillBudget: Infinity, finePercussion: true, fineMelody: 'supported', instrumentFillStrength: .035,
    drumFillDensity: .25, doubleEveryBars: 1 },
};

const VECTORS = [
  [0, 1],
  [0, -1],
  [-1, 0],
  [1, 0],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
];
const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const round = (n) => Math.round(n * 10000) / 10000;
const finite = (n, fallback) => (Number.isFinite(n) ? n : fallback);
const byBeat = (a, b) => a.beat - b.beat || (a.color ?? 0) - (b.color ?? 0);

function seedNumber(seed) {
  let hash = 2166136261;
  for (const c of String(seed))
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}

// This hash chooses sparse wall/bomb sides only. Musical hit selection and
// exact note timing never use random draws.
function noise(seed, a, b = 0) {
  let x =
    (seed ^ Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function normalizeAnalysis(analysis) {
  if (
    !analysis ||
    !Number.isFinite(analysis.duration) ||
    analysis.duration <= 0
  ) {
    throw new TypeError(
      "Audio analysis must include a positive duration in seconds.",
    );
  }
  if (
    !Number.isFinite(analysis.bpm) ||
    analysis.bpm < 30 ||
    analysis.bpm > 400
  ) {
    throw new RangeError("BPM must be between 30 and 400.");
  }
  if (analysis.duration > 7200)
    throw new RangeError("Please trim the audio to two hours or less.");
  const offset = finite(analysis.offset, 0);
  const bpm = analysis.bpm;
  const hasAcousticEvidence =
    Object.hasOwn(analysis, "rhythmEvents") ||
    Object.hasOwn(analysis, "onsets") || Object.hasOwn(analysis, "percussionEvents");
  const onsets = (analysis.rhythmEvents ?? analysis.onsets ?? [])
    .map((o) =>
      typeof o === "number"
        ? { time: o, strength: 0.7, low: 0.33, mid: 0.34, high: 0.33 }
        : { ...o, strength: clamp(finite(o.strength, 0.7)) },
    )
    .filter(
      (o) =>
        Number.isFinite(o.time) && o.time >= 0 && o.time <= analysis.duration,
    )
    .sort((a, b) => a.time - b.time);
  const sections = (analysis.sections ?? [])
    .filter(
      (s) =>
        Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start,
    )
    .map((s) => ({ ...s, energy: clamp(finite(s.energy, 0.6)) }))
    .sort((a, b) => a.start - b.start);
  const energy = analysis.energy ?? [];
  const frameDuration = finite(
    analysis.frameDuration,
    analysis.duration / Math.max(1, energy.length),
  );
  const timeAt = (beat) => offset + (beat * 60) / bpm;
  const beatAt = (time) => ((time - offset) * bpm) / 60;
  function sectionAt(time) {
    // Sections are normally a few bars long; binary search avoids rescanning
    // the full track for every sixteenth note in long files.
    let lo = 0,
      hi = sections.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (sections[mid].start > time) hi = mid - 1;
      else lo = mid + 1;
    }
    const section = sections[hi];
    return section && time < section.end ? section : undefined;
  }
  function energyAt(time) {
    const sectionEnergy = sectionAt(time)?.energy;
    if (!energy.length) return sectionEnergy ?? 0.65;
    if (typeof energy[0] === "number") {
      const index = clamp(
        Math.floor(time / frameDuration),
        0,
        energy.length - 1,
      );
      return clamp(finite(energy[index], sectionEnergy ?? 0.65));
    }
    // Accept timestamped features too, for imported or future analyzers.
    let lo = 0,
      hi = energy.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (energy[mid].time > time) hi = mid - 1;
      else lo = mid + 1;
    }
    const item = energy[Math.max(0, hi)];
    return clamp(finite(item?.value ?? item?.energy, sectionEnergy ?? 0.65));
  }
  const onsetByQuarter = new Map();
  for (const onset of onsets) {
    const beat = beatAt(onset.time);
    const tick = Math.round(beat * 4);
    // Do not pull a badly timed acoustic event onto a distant musical grid.
    if ((Math.abs(tick / 4 - beat) * 60) / bpm > 0.09) continue;
    if (
      !onsetByQuarter.has(tick) ||
      onsetByQuarter.get(tick).strength < onset.strength
    )
      onsetByQuarter.set(tick, onset);
  }
  return {
    bpm,
    offset,
    duration: analysis.duration,
    sections,
    onsets,
    percussionSource: analysis.percussionSource ?? analysis.percussionMethod ?? "",
    drumActiveRanges: Array.isArray(analysis.drumQuality?.activeRanges) ? analysis.drumQuality.activeRanges : null,
    percussionEvents: Array.isArray(analysis.percussionEvents) ? analysis.percussionEvents.filter(event => Number.isFinite(event.time)).sort((a, b) => a.time - b.time) : null,
    melodicEvents: (analysis.melodicEvents ?? []).filter(event => Number.isFinite(event.time)).sort((a, b) => a.time - b.time),
    energyAt,
    sectionAt,
    timeAt,
    beatAt,
    onsetByQuarter,
    hasAcousticEvidence,
    beatTimes: analysis.beatTimes ?? [],
    modelBeatTimes: analysis.modelBeatTimes ?? [],
    beatSource: analysis.beatSource ?? "inferred",
    silent: analysis.silent === true,
    endBeat: Math.max(0, beatAt(analysis.duration - 0.45)),
    startBeat: Math.max(0, beatAt(Math.min(1.25, analysis.duration * 0.2))),
  };
}

function makeWalls(context, level, seed, enabled) {
  if (!enabled) return [];
  const result = [];
  const spacing = level < 2 ? 64 : 32;
  for (let beat = spacing / 2; beat + 3 < context.endBeat; beat += spacing) {
    if (beat < context.startBeat) continue;
    let time = context.timeAt(beat);
    const anchors = context.wallPulses ?? [];
    if (anchors.length) time = anchors.reduce((nearest, pulse) => Math.abs(pulse.time - time) < Math.abs(nearest.time - time) ? pulse : nearest).time;
    else if (context.hasAcousticEvidence) continue;
    const wallBeat = context.beatAt(time);
    if (context.energyAt(time + 0.04) < 0.045) continue;
    const side =
      (Math.floor(beat / spacing) + Math.floor(noise(seed, 912) * 2)) % 2;
    // Single edge walls frame phrases while preserving both central lanes.
    // Clamp duration in seconds so high/low BPM cannot produce long holds.
    result.push({
      beat: round(wallBeat),
      x: side ? 3 : 0,
      y: 0,
      width: 1,
      height: 5,
      duration: round(
        Math.min(2, (context.bpm / 60) * (level < 2 ? 0.8 : 1.1)),
      ),
    });
  }
  return result;
}

function wallAt(walls, beat, x, margin = 0) {
  return walls.find(
    (w) =>
      beat >= w.beat - margin &&
      beat <= w.beat + w.duration + margin &&
      x >= w.x &&
      x < w.x + w.width,
  );
}

function chooseDirection(lastDirection, down, diagonal, sign) {
  const vertical = down ? 1 : 0;
  const desired = diagonal
    ? down
      ? sign < 0
        ? 6
        : 7
      : sign < 0
        ? 4
        : 5
    : vertical;
  if (lastDirection === undefined) return desired;
  const a = VECTORS[lastDirection],
    b = VECTORS[desired];
  // A minimum 135 degree direction change. Returning to vertical always works
  // after one of this generator's up/down diagonal cuts.
  return a[0] * b[0] + a[1] * b[1] <= -0.7 ? desired : vertical;
}

const median = values => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** A learned quarter-pulse is the timing authority. Broadband attacks provide
 * subdivision evidence, never a replacement for that musical pulse. */
function buildPulse(context) {
  const clean = values => [...new Set(values.map(value => typeof value === 'number' ? value : value?.time)
    .filter(time => Number.isFinite(time) && time >= 0 && time <= context.duration))].sort((a, b) => a - b);
  const learned = clean(context.modelBeatTimes);
  const inferred = clean(context.beatTimes);
  const supplied = learned.length >= 4 ? learned : inferred;
  const source = learned.length >= 4 || context.beatSource === 'learned' ? 'learned' : 'inferred';
  const synthetic = !context.hasAcousticEvidence && supplied.length < 4;
  if (context.silent || (supplied.length < 4 && context.hasAcousticEvidence && context.onsets.length + (context.percussionEvents?.length ?? 0) + context.melodicEvents.length < 4)) {
    return { pulses: [], source, smoothed: false, synthetic, period: 60 / context.bpm };
  }
  if (supplied.length < 4) {
    const period = 60 / context.bpm;
    const pulses = [];
    for (let index = 0; context.timeAt(index) <= context.duration - .45; index++) {
      if (context.timeAt(index) >= 0) pulses.push({ time: context.timeAt(index), index });
    }
    return { pulses, source: synthetic ? 'synthetic' : 'inferred', smoothed: false, synthetic, period };
  }
  const intervals = supplied.slice(1).map((time, index) => time - supplied[index]).filter(interval => interval > .12 && interval < 2.1);
  const period = median(intervals) || 60 / context.bpm;
  const intervalMAD = median(intervals.map(interval => Math.abs(interval - period)));
  // Do not flatten tempo changes or swing. Stable recordings can remove the
  // detector's frame jitter and fill occasional missed beats with a robust fit.
  if (intervalMAD / period <= .05) {
    const scalarPeriod = 60 / context.bpm;
    const initialPeriod = Math.abs(scalarPeriod - period) < period * .08 ? scalarPeriod : period;
    const origin = supplied[0];
    let points = supplied.map(time => ({ time, index: Math.round((time - origin) / initialPeriod) }))
      .filter(point => Math.abs(point.time - (origin + point.index * initialPeriod)) <= Math.max(.055, period * .13));
    let fittedOrigin = origin, fittedPeriod = initialPeriod;
    for (let pass = 0; pass < 2 && points.length >= 4; pass++) {
      const x = points.reduce((sum, point) => sum + point.index, 0) / points.length;
      const y = points.reduce((sum, point) => sum + point.time, 0) / points.length;
      const denominator = points.reduce((sum, point) => sum + (point.index - x) ** 2, 0);
      fittedPeriod = points.reduce((sum, point) => sum + (point.index - x) * (point.time - y), 0) / denominator;
      fittedOrigin = y - fittedPeriod * x;
      points = points.filter(point => Math.abs(point.time - (fittedOrigin + point.index * fittedPeriod)) < Math.max(.04, period * .08));
    }
    if (points.length >= supplied.length * .7 && fittedPeriod > .12 && Math.abs(fittedPeriod - period) < period * .08) {
      const pulses = [];
      const lastIndex = Math.round((supplied.at(-1) - fittedOrigin) / fittedPeriod);
      for (let index = 0; index <= lastIndex; index++) pulses.push({ time: fittedOrigin + index * fittedPeriod, index });
      return { pulses, source, smoothed: true, synthetic: false, period: fittedPeriod };
    }
  }
  return { pulses: supplied.map((time, index) => ({ time, index })), source, smoothed: false, synthetic: false, period };
}

function positionOnPulse(pulses, time) {
  let lo = 0, hi = pulses.length - 1;
  while (lo <= hi) { const mid = (lo + hi) >>> 1; if (pulses[mid].time <= time) lo = mid + 1; else hi = mid - 1; }
  if (hi < 0 || hi >= pulses.length - 1) return null;
  return hi + (time - pulses[hi].time) / (pulses[hi + 1].time - pulses[hi].time);
}

/** Explicit separated percussion changes the backbone from a quarter pulse
 * into the heard groove. A dembow pattern is not four metronome clicks. */
function buildPercussionRhythm(context, pulse) {
  const isolatedDrums = /demucs|isolated-drums|learned-drums/i.test(context.percussionSource)
    || context.percussionEvents.some(event => /demucs|isolated-drums/i.test(event.source ?? ''));
  const isolatedInstruments = context.melodicEvents.some(event=>event.source==='demucs-htdemucs-other');
  const valid = (source, melodic = false, fineMelody = false) => {
    const grouped = new Map();
    for (const raw of source) {
      if (melodic && raw.instrumentMethod === 'tonal-attacks-vocal-veto' && (raw.tonalConfidence < .65 || !(raw.attackContrast >= 1.3 || raw.spectralChange >= .18 && raw.attackContrast >= .85) || raw.vocalDominance > 15 || raw.vocalDominance > 4 && raw.vocalCoherence > .18)) continue;
      if (isolatedDrums && !melodic && context.drumActiveRanges !== null && !context.drumActiveRanges.some(range => raw.time >= range.start && raw.time <= range.end)) continue;
      const position = positionOnPulse(pulse.pulses, raw.time);
      if (position === null) continue;
      // Only isolated drum detail may use 32nds; mixed-track melody remains
      // on the coarser grid to avoid turning vocal consonants into busy fills.
      const resolution = (isolatedDrums && !melodic && raw.detail) || fineMelody ? 8 : 4;
      const tick = Math.round(position * resolution) * 4 / resolution;
      if (fineMelody && Number.isInteger(tick)) continue;
      const confidence = finite(raw.confidence, .6);
      const strength = clamp(finite(raw.strength, .5));
      const beat = context.beatAt(raw.time);
      const energy = Math.max(context.energyAt(raw.time), context.energyAt(raw.time + .04));
      if (Math.abs(position - tick / 4) > .10 || confidence < (isolatedDrums && !melodic ? .4 : .35) || strength < (isolatedDrums && !melodic ? .025 : isolatedInstruments && melodic ? .025 : .08)
        || beat < context.startBeat || beat > context.endBeat || energy < .035) continue;
      const rawKind = raw.kind === 'hat' ? 'high' : raw.kind;
      const kind = melodic ? 'melodic' : ['kick','snare','high'].includes(rawKind) ? rawKind : isolatedDrums ? (raw.low > .5 ? 'kick' : 'snare') : 'mid';
      if (!melodic && !['kick', 'snare', 'high'].includes(kind)) continue;
      const phaseTick = ((tick % 16) + 16) % 16;
      const event = { ...raw, time: raw.time, beat, confidence, strength, kind, energy,
        index: Math.floor(tick / 4), tick, bar: Math.floor(tick / 16), window: Math.floor(tick / 64),
        phase: phaseTick / 4, phaseTick, slot: Math.floor(tick / 4) % 8,
        isPulse: tick % 4 === 0, melodic, fineMelody, rhythmicError:Math.abs(position-tick/4), primary: false };
      const existing = grouped.get(tick);
      if (!existing || (existing.detail && !event.detail) || (!!existing.detail === !!event.detail && strength * confidence > existing.strength * existing.confidence)) grouped.set(tick, event);
    }
    return [...grouped.values()].sort((a, b) => a.time - b.time);
  };
  const drums = valid(context.percussionEvents);
  const melody = [...valid(context.melodicEvents, true),...valid(context.melodicEvents,true,true)];
  const windows = new Map();
  for (const event of [...drums, ...melody]) {
    if (!windows.has(event.window)) windows.set(event.window, new Map());
    const key = `${event.fineMelody ? 'melody-detail' : event.melodic ? 'melody' : event.kind === 'high' || event.detail ? 'high' : 'drum'}:${event.phaseTick}`;
    const phases = windows.get(event.window);
    if (!phases.has(key)) phases.set(key, { phase: event.phaseTick, bars: new Set(), strength: 0, count: 0, melodic: event.melodic, fineMelody: event.fineMelody, high: event.kind === 'high' || !!event.detail });
    const item = phases.get(key);
    item.bars.add(event.bar); item.strength += event.strength; item.count++;
  }
  const regimes = new Map();
  for (const window of windows.keys()) {
    const items = drums.filter(event => event.window === window && event.kind !== 'high' && !event.detail);
    const strength = median(items.map(event => event.strength));
    const dominance = median(items.map(event => finite(event.percussiveRatio, 0)));
    regimes.set(window, isolatedDrums ? items.length >= 4 && median(items.map(event=>event.confidence)) >= .4 : strength >= .45 || (strength >= .3 && dominance > .6));
  }
  const masks = new Map();
  for (const [window, phases] of windows) {
    const selected = [...phases.values()].filter(item => item.bars.size >= (item.high ? 3 : 2) && (item.melodic || regimes.get(window)))
      .map(item => ({ ...item, primary: !item.high && !item.melodic,
        score: item.strength / item.count + (item.phase % 4 === 0 ? .22 : item.phase % 2 === 0 ? .06 : 0) }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || b.score - a.score || a.phase - b.phase);
    masks.set(window, selected);
  }
  const regimeThresholds = new Map();
  for (const window of windows.keys()) {
    const strengths = drums.filter(event => event.window === window && event.kind !== 'high' && !event.detail).map(event => event.strength).sort((a,b)=>a-b);
    const strong = strengths[Math.floor(strengths.length * .9)] ?? .75;
    regimeThresholds.set(window, isolatedDrums ? Math.max(.025, strong * .2) : Math.max(.3, Math.min(.45, strong * .6)));
  }
  const coreBars = new Set();
  for (const event of drums) {
    const mask = masks.get(event.window) ?? [];
    event.primary = mask.some(item => item.primary && item.phase === event.phaseTick) && event.kind !== 'high' && !event.detail && event.strength >= regimeThresholds.get(event.window);
    event.hat = (event.kind === 'high' || event.detail) && mask.some(item => item.high && item.phase === event.phaseTick);
    if (event.primary) coreBars.add(event.bar);
  }
  const events = [];
  for (const event of drums) {
    const mask = masks.get(event.window) ?? [];
    event.fill = !event.primary && !event.hat && event.confidence >= .8 && event.strength >= (isolatedDrums ? regimeThresholds.get(event.window) : .45) && mask.some(item => item.primary);
    if (!event.primary && !event.hat && !event.fill) continue;
    event.signature = `groove:${mask.filter(item => item.primary).map(item => item.phase).sort((a,b) => a-b).join(',')}`;
    event.impact = event.primary && event.phaseTick % 8 === 0 && event.strength > .55;
    events.push(event);
  }
  for (const event of melody) {
    const mask = masks.get(event.window) ?? [];
    if (event.fineMelody) {
      const isolatedFill=isolatedInstruments&&event.strength>=.035&&event.rhythmicError<=.04;
      if (!isolatedFill&&(event.strength < .1 || !mask.some(item=>item.fineMelody&&item.phase===event.phaseTick&&item.bars.size>=3))) continue;
      event.primary=false;event.secondary=true;event.signature='melodic-detail';event.impact=false;
      events.push(event);continue;
    }
    const repeatedPhase = mask.some(item => item.melodic && item.phase === event.phaseTick);
    const layered = coreBars.has(event.bar);
    const isolatedFill=isolatedInstruments&&event.strength>=.035&&event.rhythmicError<=.065;
    if (layered && (!mask.some(item=>item.melodic&&item.phase===event.phaseTick&&item.bars.size>=2) || event.strength < (isolatedInstruments ? .035 : .1))) {
      if(!isolatedFill)continue;
      event.expertFill=true;
    }
    const sameFraction = melody.filter(other => other.window === event.window && other.phaseTick % 4 === event.phaseTick % 4);
    if (!repeatedPhase && new Set(sameFraction.map(other => other.index)).size < 3) {
      if(!isolatedFill)continue;
      event.expertFill=true;
    }
    if (isolatedInstruments && event.strength<.08)event.expertFill=true;
    event.primary = !layered && !event.expertFill;
    event.secondary = layered || event.expertFill;
    event.signature = `melody:${mask.filter(item => item.melodic).map(item => item.phase).sort((a,b)=>a-b).join(',')}`;
    event.impact = false;
    events.push(event);
  }
  const activePulses = pulse.pulses.map(({ time, index }) => ({ time, index, beat: context.beatAt(time) }))
    .filter(event => event.beat >= context.startBeat && event.beat <= context.endBeat && Math.max(context.energyAt(event.time), context.energyAt(event.time + .05)) >= .035);
  const windowEnergy = new Map();
  for (const window of new Set(events.map(event => event.window))) {
    const items = events.filter(event => event.window === window);
    windowEnergy.set(window, items.reduce((sum, event) => sum + event.energy, 0) / items.length);
  }
  return { events: events.sort((a,b)=>a.time-b.time), pulse, masks, activePulses, windowEnergy,
    mode: 'percussion-groove', percussionSource: isolatedDrums ? 'isolated-drums' : 'hpss', regimes, synthetic: false,
    signatures: new Set(events.map(event => event.signature)).size };
}

function buildRhythm(context) {
  const pulse = buildPulse(context);
  if (context.percussionEvents !== null) return buildPercussionRhythm(context, pulse);
  const { pulses } = pulse;
  const windows = new Map();
  const candidates = [];
  const percussion = context.onsets.filter(event => {
    const kind = event.kind ?? (event.low > .55 ? 'kick' : event.high > .45 ? 'high' : 'mid');
    return ['kick', 'snare', 'high'].includes(kind) && finite(event.confidence, .8) >= .35 && event.strength >= .12;
  });
  const positionAt = time => {
    let lo = 0, hi = pulses.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >>> 1; if (pulses[mid].time <= time) lo = mid + 1; else hi = mid - 1; }
    if (hi < 0 || hi >= pulses.length - 1) return null;
    return hi + (time - pulses[hi].time) / (pulses[hi + 1].time - pulses[hi].time);
  };
  for (const event of percussion) {
    const position = positionAt(event.time);
    if (position === null) continue;
    const tick = Math.round(position * 4);
    // Only recurring 1/2- and 1/4-pulse percussion can add subdivisions.
    // Vocal syllables and attacks far from the pulse never become hit clocks.
    if (tick % 4 === 0 || Math.abs(position - tick / 4) > .085) continue;
    const window = Math.floor(tick / 64);
    const phase = ((tick % 16) + 16) % 16;
    if (!windows.has(window)) windows.set(window, new Map());
    const phases = windows.get(window);
    if (!phases.has(phase)) phases.set(phase, { phase, bars: new Set(), strength: 0, count: 0, events: new Map() });
    const item = phases.get(phase);
    const bar = Math.floor(tick / 16);
    item.bars.add(bar); item.strength += event.strength; item.count++;
    const previous = item.events.get(bar);
    if (!previous || previous.strength < event.strength) item.events.set(bar, event);
  }
  const globalPhaseCounts = new Map();
  for (const phases of windows.values()) for (const item of phases.values()) globalPhaseCounts.set(item.phase, (globalPhaseCounts.get(item.phase) ?? 0) + item.bars.size);
  const masks = new Map();
  for (const [window, phases] of windows) {
    const supported = [...phases.values()].filter(item => item.bars.size >= 3)
      .map(item => ({ ...item, score: (globalPhaseCounts.get(item.phase) ?? 0) + item.strength / item.count + (item.phase % 2 === 0 ? .15 : 0) }))
      .sort((a, b) => b.score - a.score || a.phase - b.phase);
    masks.set(window, supported);
  }
  const activePulses = [];
  for (let index = 0; index < pulses.length; index++) {
    const { time } = pulses[index];
    const beat = context.beatAt(time);
    const energy = Math.max(context.energyAt(time), context.energyAt(time + .05));
    if (beat < context.startBeat || beat > context.endBeat || energy < .035) continue;
    const bar = Math.floor(index / 4);
    const window = Math.floor(index / 16);
    const near = percussion.filter(event => Math.abs(event.time - time) <= pulse.period * .13)
      .sort((a, b) => b.strength - a.strength)[0];
    const kind = near?.kind ?? (near?.low > .55 ? 'kick' : 'pulse');
    const signature = `pulse:${(masks.get(window) ?? []).map(item => item.phase).sort((a, b) => a - b).join(',')}`;
    const anchor = { time, beat, energy, kind, strength: near?.strength ?? .5, confidence: 1,
      index, bar, window, phase: index % 4, slot: index % 8, signature,
      isPulse: true, impact: index % 4 === 0 && ['kick', 'snare'].includes(kind) && near.strength > .45 };
    candidates.push(anchor); activePulses.push(anchor);
    const next = pulses[index + 1];
    if (!next) continue;
    for (const fraction of [.25, .5, .75]) {
      const phase = (index % 4) * 4 + fraction * 4;
      const evidence = (masks.get(window) ?? []).find(item => item.phase === phase);
      const event = evidence?.events.get(bar);
      if (!event) continue;
      const subdivisionTime = time + fraction * (next.time - time);
      const subdivisionBeat = context.beatAt(subdivisionTime);
      if (subdivisionBeat > context.endBeat) continue;
      candidates.push({ ...anchor, time: subdivisionTime, beat: subdivisionBeat,
        kind: event.kind ?? 'high', strength: event.strength, confidence: finite(event.confidence, .8),
        phase: (index % 4) + fraction, isPulse: false, impact: false, fraction,
        recurringSupport: evidence.bars.size, evidencePhase: phase });
    }
  }
  const windowEnergy = new Map();
  for (const window of new Set(activePulses.map(event => event.window))) {
    const selected = activePulses.filter(event => event.window === window);
    windowEnergy.set(window, selected.reduce((sum, event) => sum + event.energy, 0) / selected.length);
  }
  return { events: candidates.sort((a, b) => a.time - b.time), pulse, masks, activePulses, windowEnergy,
    mode: 'pulse-fallback', synthetic: pulse.synthetic, signatures: new Set([...masks.values()].map(mask => mask.map(item => item.phase).join(','))).size };
}

function chooseRhythm(context, rhythm, profile, level, density) {
  const output = [];
  if (rhythm.mode === 'percussion-groove') {
    const detailPhases = new Map();
    const tonalFillPhases = new Map();
    for (const event of rhythm.events) {
      if (event.primary) { output.push(event); continue; }
      const windowMask = rhythm.masks.get(event.window) ?? [];
      if (event.fineMelody) {
        const recurring = windowMask.some(item => item.fineMelody && item.phase === event.phaseTick && item.bars.size >= 3);
        const admitted = profile.fineMelody === 'supported'
          || profile.fineMelody === 'strong' && event.strength >= .08
          || profile.fineMelody === 'recurring' && event.strength >= .12 && recurring;
        if (density > .35 && admitted) output.push(event);
        continue;
      }
      if (event.expertFill) {
        let provenTonalPhase = false;
        if (profile.tonalFillBudget > 0 && event.instrumentMethod === 'tonal-attacks-vocal-veto') {
          if (!tonalFillPhases.has(event.window)) {
            const phases = new Map();
            for (const candidate of rhythm.events) {
              if (candidate.window !== event.window || !candidate.expertFill || candidate.fineMelody || candidate.instrumentMethod !== 'tonal-attacks-vocal-veto') continue;
              const quality = candidate.strength + .25 * candidate.tonalConfidence + .05 * Math.min(4, candidate.attackContrast);
              phases.set(candidate.phaseTick, Math.max(phases.get(candidate.phaseTick) ?? 0, quality));
            }
            const ranked = [...phases].sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
            const budget = Number.isFinite(profile.tonalFillBudget) ? Math.max(1, Math.round(profile.tonalFillBudget * density / .65)) : Infinity;
            tonalFillPhases.set(event.window, new Set(ranked.slice(0,budget).map(([phase])=>phase)));
          }
          provenTonalPhase = tonalFillPhases.get(event.window).has(event.phaseTick);
        }
        if (density > .35 && (event.strength >= profile.instrumentFillStrength || provenTonalPhase)) output.push(event);
        continue;
      }
      if (density > .25 && (event.hat || event.secondary)) {
        const key = `${event.window}:${event.secondary ? 'instrument' : 'percussion'}`;
        if (!detailPhases.has(key)) {
          // Keep the drum groove intact; an overlapping instrument attack
          // cannot consume a detail slot that could fill an actual gap.
          const mask = windowMask.filter(item => event.secondary
            ? item.melodic && !item.fineMelody && item.bars.size >= 2 && !windowMask.some(drum => drum.primary && drum.phase === item.phase)
            : item.high && (profile.finePercussion || Number.isInteger(item.phase)));
          const budget = Math.max(1, Math.round(profile.detailBudget * density / .65));
          detailPhases.set(key, new Set(mask.slice(0, budget).map(item => item.phase)));
        }
        if (detailPhases.get(key).has(event.phaseTick)) output.push(event);
      } else if (event.fill && density >= profile.drumFillDensity) output.push(event);
    }
    return output.sort((a,b) => a.time-b.time);
  }
  // Without separated drums, preserve the complete pulse and add only the
  // same recurring percussion-supported masks used by the former Hard tier.
  let stride = 1;
  while (stride * rhythm.pulse.period < Math.max(profile.gap, profile.handGap / 2)) stride *= 2;
  for (const event of rhythm.events) {
    if (event.isPulse) {
      if (event.index % stride === 0) output.push(event);
      continue;
    }
    const maximum = [2, 3, 4, 6, 8][level];
    const budget = Math.round(maximum * density * (.45 + (rhythm.windowEnergy.get(event.window) ?? event.energy) * .75));
    if ((rhythm.masks.get(event.window) ?? []).slice(0, budget).some(item => item.phase === event.evidencePhase)) output.push(event);
  }
  return output.sort((a,b) => a.time-b.time);
}

/** For lightshow synchronization. Times are pulse anchors/interpolated,
 * recurring percussion subdivisions, not arbitrary broadband attack peaks. */
export function getRhythmAnchors(analysis) {
  const context = normalizeAnalysis(analysis);
  return buildRhythm(context).events.map(event => ({ time: event.time, beat: event.beat,
    kind: event.kind, strength: event.strength, isPulse: event.isPulse, phase: event.phase }));
}

function makeNotes(context, rhythm, profile, level, controls, walls, retainedTimes = new Set()) {
  const notes = [];
  const hands = [
    { time: -Infinity, direction: undefined, hits: 0 },
    { time: -Infinity, direction: undefined, hits: 0 },
  ];
  const { seed, density, intensity, style } = controls;
  const motion = profile.motion;
  const proposed = chooseRhythm(context, rhythm, profile, level, density);
  const proposedTimes = new Set(proposed.map(event=>event.time));
  // A larger detail vocabulary must add to the established groove. Ranking
  // 32nd phases must not evict a coarser phase from the preceding difficulty.
  for(const event of rhythm.events)if(retainedTimes.has(event.time)&&!proposedTimes.has(event.time)) {
    proposed.push(event);proposedTimes.add(event.time);
  }
  proposed.sort((a,b)=>a.time-b.time);
  const admissible = rhythm.mode === 'percussion-groove' ? [] : proposed;
  if (rhythm.mode === 'percussion-groove') {
    const ranked = [...proposed].sort((a,b) => Number(b.primary)-Number(a.primary) || Number(retainedTimes.has(b.time))-Number(retainedTimes.has(a.time)) || Number(a.melodic)-Number(b.melodic) || b.strength*b.confidence-a.strength*a.confidence || a.time-b.time);
    const clearance=Math.max(profile.gap,profile.handGap/2);
    for (const event of ranked) if (!admissible.some(other => Math.abs(other.time-event.time) < clearance-1e-6)) admissible.push(event);
    admissible.sort((a,b)=>a.time-b.time);
  }
  const selected = admissible.filter((event, index) => {
    if (rhythm.mode === 'percussion-groove' || event.isPulse) return true;
    const previousPulse = rhythm.activePulses.findLast(pulse => pulse.time < event.time);
    const nextPulse = rhythm.activePulses.find(pulse => pulse.time > event.time);
    const clearance = Math.max(profile.gap, profile.handGap / 2);
    return (!previousPulse || event.time - previousPulse.time >= clearance) && (!nextPulse || nextPulse.time - event.time >= clearance);
  });
  const lanePhrases = [
    [1, 1, 0, 0, 1, 1, 0, 0],
    [0, 0, 1, 1, 0, 0, 1, 1],
    [1, 0, 0, 1, 1, 0, 0, 1],
    [0, 1, 1, 0, 0, 1, 1, 0],
  ];
  const styleShift =
    style === "dance"
      ? 1
      : style === "technical"
        ? 2
        : style === "cinematic"
          ? 3
          : 0;
  let nextHand = seed % 2;
  let lastHitTime = -Infinity;
  for (const [index, event] of selected.entries()) {
    const { time, energy, slot, signature } = event;
    const beat = round(event.beat);
    if (time - lastHitTime < profile.gap - 1e-6) continue;
    const available = (hand) =>
      time - hands[hand].time >= profile.handGap - 1e-6;
    let hand = nextHand;
    if (!available(hand)) hand = 1 - hand;
    if (!available(hand)) continue;
    // The seed chooses the vocabulary for a rhythmic signature once. It has
    // no influence on which sounds become notes or their rhythm.
    const motif =
      (seedNumber(signature) + seed + styleShift + Math.max(0, motion - 2)) %
      lanePhrases.length;
    const nextGap = (selected[index + 1]?.time ?? Infinity) - time;
    const previousGap = time - lastHitTime;
    const accentedRole = event.kind === "kick" || event.kind === "snare";
    const double =
      event.impact &&
      accentedRole &&
      energy > 0.42 &&
      intensity > 0.25 &&
      available(0) &&
      available(1) &&
      previousGap >= profile.handGap &&
      nextGap >= profile.handGap &&
      event.bar % profile.doubleEveryBars === 0;
    const activeHands = double ? [0, 1] : [hand];
    for (const color of activeHands) {
      const state = hands[color];
      const down = state.hits % 2 === 0;
      let inner = !!lanePhrases[motif][slot % 8];
      if (style === "cinematic" && !event.impact) inner = false;
      let x = color === 0 ? (inner ? 1 : 0) : inner ? 2 : 3;
      if (wallAt(walls, beat, x, (context.bpm / 60) * 0.25)) {
        inner = true;
        x = color === 0 ? 1 : 2;
      }
      // Pitch is not inferred from energy. Height expresses a clear musical
      // role: low kicks stay low; stronger high responses can rise.
      let y = 0;
      if (!inner && event.kind === "snare") y = 1;
      if (
        motion >= 3 && time - state.time >= .35 &&
        !down &&
        inner &&
        event.kind !== "kick" &&
        energy > 0.55 &&
        slot % 4 === 3
      )
        y = 2;
      if (motion >= 5 && !down && !inner && event.kind !== 'kick' && slot % 4 === 1 && time - state.time >= .35) y = 2;
      const diagonal =
        !double &&
        !inner &&
        (event.kind === "snare" || (motion >= 3 && slot % 4 === 2)) &&
        intensity > 0.35;
      const sign = down ? (color === 0 ? -1 : 1) : color === 0 ? 1 : -1;
      const direction = chooseDirection(state.direction, down, diagonal, sign);
      notes.push({ beat, x, y, color, direction,
        musicalRole: event.melodic ? 'melodic' : event.kind,
        sourceTime: event.time,
        timingRole: rhythm.mode === 'percussion-groove' ? event.primary ? 'groove' : event.secondary ? 'melodic-layer' : event.hat ? 'high' : 'fill' : event.isPulse ? 'pulse' : 'subdivision' });
      state.direction = direction;
      state.time = time;
      state.hits++;
    }
    nextHand = 1 - hand;
    lastHitTime = time;
  }
  return notes.sort(byBeat);
}

function nearestNoteDistance(notes, beat) {
  let lo = 0,
    hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].beat < beat) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(
    Math.abs((notes[lo]?.beat ?? Infinity) - beat),
    Math.abs((notes[lo - 1]?.beat ?? -Infinity) - beat),
  );
}

function makeBombs(context, notes, walls, level, controls) {
  if (
    !controls.bombs ||
    level < 1 ||
    (context.hasAcousticEvidence && context.onsets.length < 2)
  )
    return [];
  const bombs = [];
  // A higher difficulty should spend its extra motion on music, rather than
  // doubling hazard pauses. At 128 BPM this is one bomb roughly every 15 s.
  const spacing = 32;
  const clearance = (context.bpm / 60) * 0.65;
  for (
    let anchor = spacing - 1;
    anchor < context.endBeat - 2;
    anchor += spacing
  ) {
    // Search only in phrase tails, so hazards punctuate a pause and do not
    // appear unexpectedly in the middle of a stream.
    for (const delta of [0, -0.5, -1, -1.5]) {
      const beat = anchor + delta;
      if (
        beat < context.startBeat ||
        context.energyAt(context.timeAt(beat)) < 0.07
      )
        continue;
      if (nearestNoteDistance(notes, beat) < clearance) continue;
      const x = noise(controls.seed, anchor, 83) < 0.5 ? 0 : 3;
      if (wallAt(walls, beat, x, clearance)) continue;
      bombs.push({ beat: round(beat), x, y: 1 });
      break;
    }
  }
  return bombs;
}

function makeLights(context, controls, bombs) {
  if (!controls.lights) return [];
  const events = [];
  const eventKeys = new Set();
  const add = (beat, type, value, floatValue = 1) => {
    if (beat < 0 || beat > context.endBeat + 0.4) return;
    beat = round(beat);
    const key = `${beat}:${type}`;
    if (eventKeys.has(key)) return;
    eventKeys.add(key);
    events.push({
      beat,
      type,
      value,
      floatValue: round(clamp(floatValue, 0, 1.4)),
    });
  };
  const { intensity, seed, style } = controls;
  // Primary/secondary legacy colors remain portable with DefaultEnvironment.
  // No repeated rapid black/white flicker: pulses are at most once per beat.
  for (
    let beat = Math.max(0, Math.ceil(context.beatAt(0)));
    beat <= context.endBeat;
    beat++
  ) {
    const time = context.timeAt(beat);
    const section = context.sectionAt(time);
    const energy = context.energyAt(time);
    const phrase = Math.floor(beat / 16);
    const color = phrase % 2 === 0 ? 0 : 4;
    const onset = context.onsetByQuarter.get(beat * 4);
    const level = 0.25 + energy * (0.4 + intensity * 0.4);
    if (energy < 0.035) {
      if (beat % 4 === 0)
        for (let type = 0; type <= 4; type++) add(beat, type, 0, 0);
      continue;
    }
    if (beat % 4 === 0) {
      add(beat, 0, color + (energy > 0.6 ? 3 : 1), level); // bass/back pulse
      add(beat, 4, color + 1, level * 0.65); // persistent visibility
    }
    const low = onset?.low ?? 0.3;
    const high = onset?.high ?? 0.3;
    if (beat % 2 === 0 || onset?.strength > 0.65)
      add(beat, 1, color + 3, level * (0.7 + low * 0.3));
    if (beat % 2 === 1 || high > 0.42) {
      const side = (beat + phrase) % 2 ? 2 : 3;
      add(beat, side, 4 - color + (style === "cinematic" ? 1 : 3), level * 0.8);
    }
    if (beat % 16 === 0) {
      add(beat, 8, 1); // ring rotation trigger
      add(beat, 9, phrase % 2); // ring zoom trigger
      const speed = Math.round(clamp(energy * (2 + intensity * 5), 0, 7));
      add(beat, 12, speed);
      add(beat, 13, Math.max(0, speed - 1));
    }
    const isBuild = /build/i.test(section?.label ?? section?.type ?? "");
    if (isBuild && beat % 2 === 0)
      add(beat + 0.25, 2 + (phrase % 2), color + 1, level);
  }
  for (const section of context.sections) {
    const beat = Math.max(0, context.beatAt(section.start));
    const next = section.energy;
    if (next > 0.68) {
      // Stagger colors across groups to make a drop read as movement.
      for (let type = 0; type <= 4; type++)
        add(
          beat + type * 0.125,
          type,
          (type % 2 ? 4 : 0) + 2,
          0.55 + intensity * 0.5,
        );
    }
  }
  // Bombs are not left in darkness, even in a sparse phrase.
  for (const bomb of bombs) add(Math.max(0, bomb.beat - 0.5), 4, 1, 0.7);
  const end = round(context.endBeat + 0.25);
  for (let type = 0; type <= 4; type++) add(end, type, 0, 0);
  return events.sort((a, b) => a.beat - b.beat || a.type - b.type);
}

/** Generate all five Standard difficulties. Does not mutate analysis. */
export function generateMaps(
  analysis,
  {
    seed = 42,
    density = 0.65,
    style = "flow",
    walls = true,
    bombs = true,
    lights = true,
    intensity = 0.65,
  } = {},
) {
  const context = normalizeAnalysis(analysis);
  const controls = {
    seed: seedNumber(seed),
    density: clamp(finite(density, 0.65)),
    intensity: clamp(finite(intensity, 0.65)),
    style,
    walls,
    bombs,
    lights,
  };
  const rhythm = buildRhythm(context);
  context.wallPulses = rhythm.mode === 'percussion-groove' ? rhythm.events.filter(event => event.primary) : rhythm.activePulses;
  const maps = {};
  for (const [level, difficulty] of DIFFICULTIES.entries()) {
    const profile = PROFILES[difficulty];
    const obstacles = makeWalls(context, level, controls.seed, walls);
    const notes = makeNotes(
      context,
      rhythm,
      profile,
      level,
      controls,
      obstacles,
      level > 0 ? new Set(maps[DIFFICULTIES[level-1]].notes.map(note=>note.sourceTime)) : new Set(),
    );
    const bombNotes = makeBombs(context, notes, obstacles, level, controls);
    const events = makeLights(context, controls, bombNotes);
    const njs = profile.njs + (level >= 2 && controls.intensity > 0.8 ? 1 : 0);
    const map = {
      notes,
      bombs: bombNotes,
      obstacles,
      events,
      njs,
      rank: profile.rank,
      bpm: context.bpm,
      offset: context.offset,
      duration: context.duration,
      difficulty,
      generation: {
        version: 4,
        difficultyCalibration: 'full-groove-baseline',
        detailBudget: profile.detailBudget,
        timingSource: `${rhythm.pulse.source}-pulse${rhythm.pulse.smoothed ? "-fit" : ""}`,
        acousticEvents: context.onsets.length,
        rhythmicSignatures: rhythm.signatures,
        seed,
        density: controls.density,
        intensity: controls.intensity,
        style,
        minHandIntervalSeconds: profile.handGap,
        minNoteIntervalSeconds: profile.gap,
      },
    };
    const uniqueBeats = [...new Set(notes.map(note => note.beat))];
    const matches = event => uniqueBeats.some(beat => Math.abs(beat - event.beat) < .001);
    const plannedRhythm = chooseRhythm(context, rhythm, profile, level, controls.density);
    const expected = plannedRhythm.filter(event => rhythm.mode === 'percussion-groove' ? event.primary : event.isPulse);
    const coveredPulses = rhythm.activePulses.filter(event => uniqueBeats.some(beat => Math.abs((beat - event.beat) * 60 / context.bpm) < .035)).length;
    const coveredBackbone = expected.filter(matches).length;
    map.rhythmDiagnostics = {
      mode: rhythm.mode,
      percussionSource: rhythm.percussionSource ?? null,
      primaryGrooveCount: rhythm.events.filter(event => event.primary && !event.melodic).length,
      melodicBackboneCount: rhythm.events.filter(event => event.primary && event.melodic).length,
      drumWindows: rhythm.regimes ? [...rhythm.regimes].filter(([, active]) => active).map(([window]) => window) : [],
      source: rhythm.pulse.source,
      pulseSmoothed: rhythm.pulse.smoothed,
      pulsePeriod: round(rhythm.pulse.period),
      pulseCount: rhythm.activePulses.length,
      coveredPulses,
      pulseCoverage: rhythm.activePulses.length ? round(coveredPulses / rhythm.activePulses.length) : 0,
      expectedBackboneCount: expected.length,
      backboneCoverage: expected.length ? round(coveredBackbone / expected.length) : 0,
      subdivisionCount: uniqueBeats.length - coveredPulses,
      patternWindows: [...rhythm.masks].map(([window, mask]) => {
        const chosen = plannedRhythm.filter(event => event.window === window);
        return { window, phases: [...new Set(chosen.map(event => event.phase))].sort((a,b)=>a-b) };
      }),
    };
    map.validation = validateGameplay(map);
    maps[difficulty] = map;
  }
  return maps;
}

function overlapsWall(object, wall) {
  return (
    object.beat >= wall.beat - 1e-5 &&
    object.beat <= wall.beat + wall.duration + 1e-5 &&
    object.x >= wall.x &&
    object.x < wall.x + wall.width &&
    object.y >= wall.y &&
    object.y < wall.y + wall.height
  );
}

/**
 * Conservative static lint, not a substitute for a VR playtest. Diagnostics
 * are {code,message,beat,indices?}. Arbitrary imported maps may intentionally
 * use techniques (e.g. same-swing sliders) outside this generator's contract.
 */
export function validateGameplay(map) {
  const errors = [],
    warnings = [];
  const notes = [...(map.notes ?? [])].sort(byBeat);
  const bombs = map.bombs ?? [],
    walls = map.obstacles ?? [];
  const bpm = finite(map.bpm, 120);
  const seconds = (beat) => (beat * 60) / bpm;
  const issue = (list, code, message, object, indices) =>
    list.push({
      code,
      message,
      beat: object.beat,
      ...(indices ? { indices } : {}),
    });
  const inGrid = (o) =>
    Number.isInteger(o.x) &&
    o.x >= 0 &&
    o.x <= 3 &&
    Number.isInteger(o.y) &&
    o.y >= 0 &&
    o.y <= 2 &&
    Number.isFinite(o.beat) &&
    o.beat >= 0;
  const cells = new Map();
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (
      !inGrid(n) ||
      ![0, 1].includes(n.color) ||
      !Number.isInteger(n.direction) ||
      n.direction < 0 ||
      n.direction > 8
    ) {
      issue(
        errors,
        "invalid-note",
        "Note position, color, direction, or beat is invalid.",
        n,
        [i],
      );
    }
    const key = `${round(n.beat)}:${n.x}:${n.y}`;
    if (cells.has(key))
      issue(
        errors,
        "note-collision",
        "Multiple notes occupy the same cell and beat.",
        n,
        [cells.get(key), i],
      );
    else cells.set(key, i);
    if ((n.x === 1 || n.x === 2) && n.y === 1)
      issue(
        warnings,
        "face-note",
        "A center-height inner note can obscure approaching objects.",
        n,
        [i],
      );
  }
  const last = [null, null];
  let minHandInterval = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (![0, 1].includes(n.color)) continue;
    const previous = last[n.color];
    if (previous) {
      const interval = seconds(n.beat - previous.note.beat);
      minHandInterval = Math.min(minHandInterval, interval);
      const minimum = map.generation?.minHandIntervalSeconds ?? 0.14;
      if (interval < minimum - 0.001)
        issue(
          errors,
          "rapid-hand-repeat",
          "The same hand must swing faster than the configured minimum interval.",
          n,
          [previous.index, i],
        );
      const a = VECTORS[previous.note.direction],
        b = VECTORS[n.direction];
      if (a && b && interval < 2 && a[0] * b[0] + a[1] * b[1] > -0.7) {
        issue(
          warnings,
          "parity-break",
          "Successive same-hand cuts have less than 135 degrees of direction change.",
          n,
          [previous.index, i],
        );
      }
    }
    last[n.color] = { note: n, index: i };
  }
  const bombCells = new Set();
  for (let i = 0; i < bombs.length; i++) {
    const b = bombs[i];
    if (!inGrid(b))
      issue(errors, "invalid-bomb", "Bomb position or beat is invalid.", b, [
        i,
      ]);
    const key = `${round(b.beat)}:${b.x}:${b.y}`;
    if (cells.has(key))
      issue(
        errors,
        "note-bomb-collision",
        "A bomb and note occupy the same cell and beat.",
        b,
        [cells.get(key), i],
      );
    if (bombCells.has(key))
      issue(
        errors,
        "bomb-collision",
        "Multiple bombs occupy the same cell and beat.",
        b,
        [i],
      );
    bombCells.add(key);
    // No bombs in swing windows: test proximity in time, not only equal cells.
    const distance = nearestNoteDistance(notes, b.beat);
    if (seconds(distance) < 0.45)
      issue(
        warnings,
        "bomb-swing-window",
        "A bomb is close in time to a cut; check the full saber path in VR.",
        b,
        [i],
      );
  }
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    if (
      !Number.isFinite(w.beat) ||
      w.beat < 0 ||
      !Number.isFinite(w.duration) ||
      w.duration <= 0 ||
      !Number.isInteger(w.x) ||
      w.x < 0 ||
      !Number.isInteger(w.width) ||
      w.width < 1 ||
      w.x + w.width > 4 ||
      !Number.isInteger(w.y) ||
      w.y < 0 ||
      !Number.isInteger(w.height) ||
      w.height < 1 ||
      w.y + w.height > 5
    ) {
      issue(
        errors,
        "invalid-wall",
        "Obstacle bounds or duration are invalid.",
        w,
        [i],
      );
    }
    if (w.width > 2 || (w.x <= 1 && w.x + w.width > 2 && w.y < 2))
      issue(
        errors,
        "unsafe-wall",
        "Obstacle blocks both central lanes or forces movement to the far edge.",
        w,
        [i],
      );
    for (const [j, n] of notes.entries())
      if (overlapsWall(n, w))
        issue(
          errors,
          "note-wall-collision",
          "A note is hidden inside a wall.",
          n,
          [j, i],
        );
    for (const [j, b] of bombs.entries())
      if (overlapsWall(b, w))
        issue(
          errors,
          "bomb-wall-collision",
          "A bomb is hidden inside a wall.",
          b,
          [j, i],
        );
    const previous = walls[i - 1];
    if (
      previous &&
      previous.width >= 2 &&
      w.width >= 2 &&
      previous.x !== w.x &&
      seconds(w.beat - previous.beat - previous.duration) < 1
    ) {
      issue(
        warnings,
        "rapid-wall-dodge",
        "Opposite-side walls leave less than a second to change sides.",
        w,
        [i - 1, i],
      );
    }
  }
  // Adjacent simultaneous inward cuts risk controller clashes. Generator
  // doubles are vertical, but imported/editable maps still need this lint.
  for (let i = 0; i < notes.length; i++) {
    for (
      let j = i + 1;
      j < notes.length && Math.abs(notes[j].beat - notes[i].beat) < 0.001;
      j++
    ) {
      const a = notes[i],
        b = notes[j];
      if (a.color === b.color) continue;
      const left = a.x < b.x ? a : b,
        right = left === a ? b : a;
      if (
        right.x - left.x <= 2 &&
        VECTORS[left.direction]?.[0] > 0 &&
        VECTORS[right.direction]?.[0] < 0
      )
        issue(
          errors,
          "handclap",
          "Simultaneous inward cuts can collide controllers.",
          a,
          [i, j],
        );
    }
  }
  const duration = finite(
    map.duration,
    Math.max(1, seconds(notes.at(-1)?.beat ?? 0)),
  );
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      notes: notes.length,
      bombs: bombs.length,
      obstacles: walls.length,
      events: map.events?.length ?? 0,
      notesPerSecond: round(notes.length / Math.max(1, duration)),
      minHandIntervalSeconds: Number.isFinite(minHandInterval)
        ? round(minHandInterval)
        : null,
    },
  };
}
