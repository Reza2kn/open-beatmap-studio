/** Native Weave v3 lightshow. Beat times are relative to the editable analysis grid. */
export const LIGHTING_ENVIRONMENT = Object.freeze({
  name: "WeaveEnvironment",
  version: "3.0.0",
  // Verified against bsmap's environment.ts; IDs are not inferred fixture names.
  groups: Object.freeze(
    Array.from({ length: 16 }, (_, id) =>
      Object.freeze({ id, count: id === 12 || id === 13 ? 12 : 8 }),
    ),
  ),
  rotationAxes: Object.freeze([0, 1]),
  translation: false,
});

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);
const round = (x) => Math.round(x * 100000) / 100000;
const mod = (x, m) => ((x % m) + m) % m;
const PATTERNS = ["ribbon", "orbit", "fan", "helix", "tunnel", "diagonal"];
const MOTIFS = {
  ribbon: { wave: 0.42, spread: 24, cycle: 16 },
  orbit: { wave: 0.3, spread: 18, cycle: 12 },
  fan: { wave: 0.12, spread: 62, cycle: 16 },
  helix: { wave: 0.6, spread: 38, cycle: 8 },
  tunnel: { wave: 0.5, spread: 12, cycle: 24 },
  diagonal: { wave: 0.28, spread: 46, cycle: 16 },
  breath: { wave: 0.8, spread: 8, cycle: 32 },
  bloom: { wave: 0.2, spread: 68, cycle: 8 },
  rise: { wave: 0.65, spread: 42, cycle: 12 },
};
const allIds = LIGHTING_ENVIRONMENT.groups.map((group) => group.id);
function hash(seed, a, b = 0) {
  let x =
    (seed ^ Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
function seedValue(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return n >>> 0;
}
const filter = (part = null, reverse = false) => ({
  f: 1,
  p: part === null ? 1 : 2,
  t: part ?? 0,
  r: Number(reverse),
});

function features(analysis) {
  if (
    !analysis ||
    !Number.isFinite(analysis.duration) ||
    analysis.duration <= 0 ||
    analysis.duration > 7200
  )
    throw new Error(
      "Lightshow audio duration must be greater than zero and at most two hours.",
    );
  if (!Number.isFinite(analysis.bpm) || analysis.bpm < 30 || analysis.bpm > 400)
    throw new Error("Lightshow BPM must be between 30 and 400.");
  const { bpm, duration } = analysis,
    offset = finite(analysis.offset);
  const period = 60 / bpm,
    beatAt = (time) => (time - offset) / period,
    timeAt = (beat) => offset + beat * period;
  const energy = analysis.energy ?? [],
    frameDuration =
      analysis.frameDuration > 0
        ? analysis.frameDuration
        : duration / Math.max(1, energy.length);
  const sections = (analysis.sections ?? [])
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
    .sort((a, b) => a.start - b.start);
  const onsets = (analysis.onsets ?? [])
    .map((o) =>
      typeof o === "number"
        ? { time: o, strength: 0.6, low: 0.34, mid: 0.33, high: 0.33 }
        : { ...o },
    )
    .filter((o) => Number.isFinite(o.time) && o.time >= 0 && o.time < duration)
    .sort((a, b) => a.time - b.time);
  function sectionAt(time) {
    let lo = 0,
      hi = sections.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >>> 1;
      if (sections[m].start > time) hi = m - 1;
      else lo = m + 1;
    }
    return {
      section: sections[hi] && sections[hi].end > time ? sections[hi] : null,
      previous: sections[hi - 1],
    };
  }
  function energyAt(time) {
    if (!energy.length)
      return clamp(finite(sectionAt(time).section?.energy, 0.5));
    // Average a short centered window so an RMS trough between hits does not turn a full phrase dark.
    const first = clamp(
      Math.floor((time - 0.07) / frameDuration),
      0,
      energy.length - 1,
    );
    const last = clamp(
      Math.ceil((time + 0.07) / frameDuration),
      first,
      energy.length - 1,
    );
    let sum = 0;
    for (let i = first; i <= last; i++) sum += clamp(finite(energy[i]));
    return sum / (last - first + 1);
  }
  return {
    bpm,
    duration,
    offset,
    period,
    beatAt,
    timeAt,
    energyAt,
    sectionAt,
    onsets,
  };
}

/**
 * Returns raw v3 color/rotation event-box groups and parallel artistic preview cues.
 * Exporters add offset*bpm/60 ONLY to top-level group.b / basicEvents.beat.
 */
export function generateLightshow(
  analysis,
  { intensity = 0.7, motion = 0.65, seed = 42, enabled = true } = {},
) {
  const ctx = features(analysis);
  intensity = clamp(finite(intensity, 0.7));
  motion = clamp(finite(motion, 0.65));
  const randomSeed = seedValue(seed);
  const result = {
    environment: LIGHTING_ENVIRONMENT.name,
    lightColorEventBoxGroups: [],
    lightRotationEventBoxGroups: [],
    lightTranslationEventBoxGroups: [],
    basicEvents: [],
    previewCues: [],
    stats: {},
  };
  const { duration, period, beatAt, timeAt, energyAt, sectionAt } = ctx;
  const colors = result.lightColorEventBoxGroups,
    rotations = result.lightRotationEventBoxGroups;
  const emptyStats = () => ({
    colorGroups: 0,
    rotationGroups: 0,
    translationGroups: 0,
    colorEvents: 0,
    cues: 0,
    patterns: [],
    phases: [],
    strobeEvents: 0,
    environmentGroups: 16,
    native: true,
  });
  if (!enabled || analysis.silent || intensity === 0) {
    result.stats = emptyStats();
    return result;
  }

  // Candidate cue times merge beat anchors with actual acoustic accents. Lighting
  // may follow a syncopation even when note difficulty omits that subdivision.
  const candidates = [{ time: 0, anchor: true }];
  for (let beat = Math.ceil(beatAt(0)); timeAt(beat) < duration - 0.08; beat++)
    candidates.push({ time: Math.max(0, timeAt(beat)), anchor: true });
  for (const onset of ctx.onsets)
    if (finite(onset.strength, 0.6) >= 0.15)
      candidates.push({ time: onset.time, onset });
  for (const section of analysis.sections ?? [])
    if (section.start > 0 && section.start < duration - 0.08)
      candidates.push({ time: section.start, anchor: true, boundary: true });
  candidates.sort((a, b) => a.time - b.time);
  const pulses = [];
  for (const candidate of candidates) {
    const last = pulses.at(-1);
    if (last && candidate.time - last.time < 0.22) {
      // Only merge coincident evidence; densely spaced later accents are
      // thinned instead of dragging a cue forward through a whole crescendo.
      if (
        candidate.time - last.time < 0.07 &&
        candidate.onset &&
        finite(candidate.onset.strength) > finite(last.onset?.strength, -1)
      ) {
        last.onset = candidate.onset;
      }
      if (candidate.time - last.time < 0.07) {
        last.anchor ||= candidate.anchor;
        last.boundary ||= candidate.boundary;
      }
    } else pulses.push({ ...candidate });
  }

  function colorGroup(time, group, cue, { off = false } = {}) {
    const remaining = Math.max(0, (duration - 0.012 - time) / period);
    if (remaining <= 0) return;
    const motif = MOTIFS[cue.pattern] ?? MOTIFS.ribbon;
    const reverse =
      (group + Math.floor(cue.beat / (cue.pattern === "helix" ? 1 : 4))) % 2 ===
      1;
    const wave = off
      ? 0
      : Math.min(remaining * 0.2, motif.wave * (0.45 + cue.fan * 0.55));
    const fade = Math.min(
      Math.max(0, remaining - wave),
      cue.phase === "quiet" ? 1.8 : cue.bass > 0.25 ? 0.72 : 0.45,
    );
    const split = !off && cue.phase !== "quiet";
    const boxes = [];
    for (let part = 0; part < (split ? 2 : 1); part++) {
      const brightness = off
        ? 0
        : clamp(cue.brightness * (part ? 0.73 : 1), 0, 1);
      // A mild gradient persists into the dim tail; explicit rest/end events use
      // r=0 so all fixtures really reach black, without negative brightness.
      const gradient =
        !off && cue.phase !== "quiet"
          ? Math.min(0.055 * intensity, brightness * 0.15)
          : 0;
      const floor = off
        ? 0
        : Math.min(brightness * 0.32, Math.max(gradient, 0.035 * intensity));
      const color =
        (cue.color +
          part +
          (cue.pattern === "helix" || cue.pattern === "diagonal"
            ? group % 2
            : 0)) %
        2;
      boxes.push({
        f: filter(split ? part : null, reverse),
        w: round(wave),
        d: 1,
        r: round(-gradient),
        t: 1,
        b: 1,
        e: [
          { b: 0, i: 0, c: color, s: round(brightness), f: 0 },
          ...(fade > 0.001
            ? [{ b: round(fade), i: 1, c: color, s: round(floor), f: 0 }]
            : []),
        ],
      });
    }
    colors.push({ b: round(beatAt(time)), g: group, e: boxes });
  }

  for (const pulse of pulses) {
    const time = pulse.time;
    if (time >= duration - 0.02) continue;
    const beat = beatAt(time),
      phrase = Math.max(0, Math.floor(beat / 16)),
      phraseProgress = mod(beat, 16) / 16;
    const { section, previous } = sectionAt(time);
    const energy = energyAt(time),
      onset = pulse.onset;
    const strength = clamp(finite(onset?.strength));
    const bass = strength * clamp(finite(onset?.low, onset ? 0.34 : 0));
    const mid = strength * clamp(finite(onset?.mid, onset ? 0.33 : 0));
    const treble = strength * clamp(finite(onset?.high, onset ? 0.33 : 0));
    const sectionEnergy = clamp(finite(section?.energy, energy));
    let phase =
      sectionEnergy < 0.12 && energy < 0.1
        ? "quiet"
        : /build/i.test(section?.label ?? "")
          ? "build"
          : sectionEnergy > 0.72
            ? "peak"
            : "flow";
    if (
      section &&
      previous &&
      sectionEnergy > finite(previous.energy) * 1.35 &&
      sectionEnergy > 0.5 &&
      time - section.start < 2 * period
    )
      phase = "drop";
    const pattern =
      phase === "quiet"
        ? "breath"
        : phase === "drop"
          ? "bloom"
          : phase === "build"
            ? "rise"
            : PATTERNS[
                (phrase +
                  Math.floor(hash(randomSeed, phrase % 4) * PATTERNS.length)) %
                  PATTERNS.length
              ];
    const color = (phrase + Math.floor(hash(randomSeed, 92) * 2)) % 2;
    const fan =
      motion *
      clamp(
        0.2 + sectionEnergy * 0.45 + bass * 0.35 + (phase === "drop" ? 0.3 : 0),
      );
    const brightness =
      intensity *
      clamp(
        (phase === "quiet"
          ? 0.055
          : 0.13 +
            energy * 0.38 +
            sectionEnergy * 0.18 +
            bass * 0.45 +
            treble * 0.2) * (phase === "drop" ? 1.3 : 1),
      );
    const sweep =
      Math.sin(
        (beat / (phase === "build" ? 8 : 16) +
          hash(randomSeed, phrase % 4, 2)) *
          2 *
          Math.PI,
      ) * motion;
    const cue = {
      time: round(time),
      beat: round(beat),
      energy: round(energy),
      bass: round(bass),
      mid: round(mid),
      treble: round(treble),
      phase,
      pattern,
      color,
      intensity,
      motion,
      brightness: round(brightness),
      fan: round(fan),
      sweep: round(sweep),
      beamAngle: round((sweep * Math.PI) / 3),
      phraseProgress: round(phraseProgress),
      duration: round(
        Math.min(
          duration - time,
          Math.max(0.18, period * (phase === "quiet" ? 2 : 0.8)),
        ),
      ),
      impact: round(clamp(bass * 0.85 + treble * 0.35)),
      groups: [],
    };
    const index = Math.floor(beat),
      bank = mod(index + phrase, 4);
    if (
      phase === "drop" ||
      pulse.boundary ||
      (pulse.anchor && mod(index, 4) === 0)
    )
      cue.groups = [...allIds];
    else if (phase === "quiet")
      cue.groups = pulse.anchor && mod(index, 4) === 0 ? [...allIds] : [];
    else if (bass > 0.18)
      cue.groups = allIds.filter((g) => mod(g, 2) === mod(index, 2));
    else if (treble > 0.18)
      cue.groups = allIds.filter((g) => mod(g + bank, 4) < 2);
    else cue.groups = allIds.filter((g) => mod(g, 4) === bank);
    if (
      phase !== "quiet" &&
      phase !== "drop" &&
      !pulse.boundary &&
      !(pulse.anchor && mod(index, 4) === 0)
    ) {
      // Each motif changes exported fixture selection as well as the preview.
      if (pattern === "diagonal")
        cue.groups = allIds.filter(
          (g) => mod(g, 4) === bank || mod(g, 4) === 3 - bank,
        );
      if (pattern === "tunnel")
        cue.groups = allIds.filter(
          (g) =>
            Math.floor(g / 4) === bank ||
            (bass > 0.18 && Math.floor(g / 4) === 3 - bank),
        );
      if (pattern === "helix")
        cue.groups = allIds.filter((g) => mod(g + Math.floor(beat * 2), 4) < 2);
      if (pattern === "fan" && bass > 0.18) cue.groups = [...allIds];
      if (pattern === "rise")
        cue.groups = allIds.filter(
          (g) => mod(g, 4) <= Math.floor(phraseProgress * 3),
        );
    }
    if (energy < 0.015 && !onset) {
      cue.brightness = 0;
      cue.phase = "quiet";
      cue.pattern = "breath";
      // Rest turns every bank off; do not leave a previous accent hanging.
      cue.groups = [...allIds];
    }
    for (const group of cue.groups)
      colorGroup(time, group, cue, { off: cue.brightness === 0 });
    result.previewCues.push(cue);
    // The native basic channels are accents only; moving fixtures are driven
    // by event boxes. No unsupported legacy ring/rotation events in this show.
    if (pulse.anchor && mod(index, 4) === 0)
      result.basicEvents.push({
        beat: round(beat),
        type: 0,
        value: cue.brightness === 0 ? 0 : color ? 7 : 3,
        floatValue: round(brightness * 0.6),
      });
  }

  // Two continuous axes, sine-like sweeps and fan distributions. Every four
  // beats avoids jitter; Weave's own transforms provide mirrored symmetry.
  if (motion > 0) {
    let cueIndex = 0;
    for (
      let beat = Math.floor(beatAt(0) / 4) * 4;
      timeAt(beat) < duration - 0.02;
      beat += 4
    ) {
      const time = Math.max(0, timeAt(beat));
      const endTime = Math.min(duration - 0.015, timeAt(beat + 4));
      if (endTime <= time) continue;
      const startBeat = beatAt(time),
        span = (endTime - time) / period;
      const energy = energyAt(time),
        phrase = Math.max(0, Math.floor(beat / 16));
      while (
        cueIndex + 1 < result.previewCues.length &&
        result.previewCues[cueIndex + 1].time <= time
      )
        cueIndex++;
      const motif =
        MOTIFS[result.previewCues[cueIndex]?.pattern] ?? MOTIFS.ribbon;
      const phase = hash(randomSeed, phrase % 4, 27) * Math.PI;
      const angle = (b, axis) =>
        mod(
          (axis ? 20 : 45) +
            motion *
              (axis ? 30 : 55) *
              Math.sin(
                (b * 2 * Math.PI) / (axis ? motif.cycle * 2 : motif.cycle) +
                  phase,
              ),
          360,
        );
      for (const group of allIds) {
        const boxes = [0, 1].map((axis) => {
          const wave = Math.min(span * 0.1, 0.3 * motion);
          return {
            f: filter(null, group % 2 === 1),
            w: round(wave),
            d: 1,
            s: round(
              motion *
                motif.spread *
                (axis ? 0.55 : 1) *
                (0.35 + energy * 0.65),
            ),
            t: 1,
            b: 1,
            a: axis,
            r: 0,
            l: [
              {
                b: 0,
                p: 0,
                e: -1,
                r: round(angle(startBeat, axis)),
                o: 0,
                l: 0,
              },
              {
                b: round(Math.max(0, span - wave)),
                p: 0,
                e: 3,
                r: round(angle(startBeat + span, axis)),
                o: 0,
                l: 0,
              },
            ],
          };
        });
        rotations.push({ b: round(startBeat), g: group, e: boxes });
      }
    }
  }
  // Explicit final blackout. Keep event and distributed tail strictly in audio.
  const endTime = Math.max(0, duration - 0.01),
    endBeat = round(beatAt(endTime));
  for (const group of allIds)
    colors.push({
      b: endBeat,
      g: group,
      e: [
        {
          f: filter(),
          w: 0,
          d: 1,
          r: 0,
          t: 1,
          b: 0,
          e: [{ b: 0, i: 0, c: 0, s: 0, f: 0 }],
        },
      ],
    });
  result.basicEvents.push({ beat: endBeat, type: 0, value: 0, floatValue: 0 });
  const byBeat = (a, b) => a.b - b.b || a.g - b.g;
  colors.sort(byBeat);
  rotations.sort(byBeat);
  result.basicEvents.sort((a, b) => a.beat - b.beat || a.type - b.type);
  result.previewCues.push({
    time: round(endTime),
    beat: endBeat,
    energy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    phase: "end",
    pattern: "blackout",
    color: 0,
    intensity,
    motion,
    brightness: 0,
    fan: 0,
    sweep: 0,
    beamAngle: 0,
    phraseProgress: 1,
    duration: 0.01,
    impact: 0,
    groups: [...allIds],
  });
  result.previewCues.sort((a, b) => a.time - b.time);
  result.stats = {
    ...emptyStats(),
    colorGroups: colors.length,
    rotationGroups: rotations.length,
    colorEvents: colors.reduce(
      (n, group) => n + group.e.reduce((m, box) => m + box.e.length, 0),
      0,
    ),
    cues: result.previewCues.length,
    patterns: [...new Set(result.previewCues.map((cue) => cue.pattern))],
    phases: [...new Set(result.previewCues.map((cue) => cue.phase))],
  };
  return result;
}
