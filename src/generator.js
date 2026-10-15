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

const PROFILES = {
  Easy: {
    rank: 1,
    step: 2,
    fill: 0.7,
    handGap: 0.68,
    gap: 0.36,
    njs: 10,
    doubles: 0,
  },
  Normal: {
    rank: 3,
    step: 1,
    fill: 0.76,
    handGap: 0.46,
    gap: 0.25,
    njs: 12,
    doubles: 0.08,
  },
  Hard: {
    rank: 5,
    step: 0.5,
    fill: 0.7,
    handGap: 0.3,
    gap: 0.15,
    njs: 14,
    doubles: 0.15,
  },
  Expert: {
    rank: 7,
    step: 0.5,
    fill: 0.95,
    handGap: 0.22,
    gap: 0.1,
    njs: 15,
    doubles: 0.24,
  },
  ExpertPlus: {
    rank: 9,
    step: 0.25,
    fill: 1.06,
    handGap: 0.16,
    gap: 0.085,
    njs: 16,
    doubles: 0.32,
  },
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

// A coordinate hash makes a motif repeat independently of how many notes the
// previous difficulty happened to accept, and keeps all controls reproducible.
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
  const onsets = (analysis.onsets ?? [])
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
    energyAt,
    sectionAt,
    timeAt,
    beatAt,
    onsetByQuarter,
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
    const time = context.timeAt(beat);
    if (context.energyAt(time) < 0.045) continue;
    const side =
      (Math.floor(beat / spacing) + Math.floor(noise(seed, 912) * 2)) % 2;
    // Single edge walls frame phrases while preserving both central lanes.
    // Clamp duration in seconds so high/low BPM cannot produce long holds.
    result.push({
      beat: round(beat),
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

function phraseStyle(seed, phrase, style) {
  // Six 16-beat spatial motifs: anchors, fans, staircases, pulses, ribbons,
  // and mirrored sweeps. Reuse motif choice every four phrases for identity.
  const repeatedPhrase = phrase % 4;
  const shift =
    style === "dance"
      ? 2
      : style === "technical"
        ? 4
        : style === "cinematic"
          ? 1
          : 0;
  return (Math.floor(noise(seed, repeatedPhrase, 33) * 6) + shift) % 6;
}

function makeNotes(
  context,
  profile,
  level,
  controls,
  walls,
  reservedBombs = [],
) {
  const notes = [];
  const hands = [
    { time: -Infinity, direction: undefined, hits: 0 },
    { time: -Infinity, direction: undefined, hits: 0 },
  ];
  const { seed, density, intensity, style } = controls;
  let nextHand = Math.floor(noise(seed, 18) * 2);
  let lastHitTime = -Infinity;
  const firstTick = Math.ceil(context.startBeat / profile.step);
  const lastTick = Math.floor(context.endBeat / profile.step);
  for (let tick = firstTick; tick <= lastTick; tick++) {
    const beat = round(tick * profile.step);
    const time = context.timeAt(beat);
    // Give each planned hazard a visible, deliberate rest. The same rest is
    // maintained on either side so a saber's follow-through cannot hit it.
    if (
      reservedBombs.some(
        (b) => (Math.abs(beat - b.beat) * 60) / context.bpm < 0.72,
      )
    )
      continue;
    if (time - lastHitTime < profile.gap - 1e-6) continue;
    const rawEnergy = context.energyAt(time);
    // Silence stays empty. Sustained quieter sections are thinned, not filled
    // with a uniform metronome because the duration happens to be nonzero.
    if (rawEnergy < 0.035) continue;
    const section = context.sectionAt(time);
    const energy = clamp(
      rawEnergy * 0.6 + (section?.energy ?? rawEnergy) * 0.4,
    );
    const onset = context.onsetByQuarter.get(Math.round(beat * 4));
    const phrase = Math.floor(beat / 16);
    const inPhrase = beat % 16;
    const onBeat = Math.abs(beat - Math.round(beat)) < 1e-5;
    const downbeat = Math.abs(beat / 4 - Math.round(beat / 4)) < 1e-5;
    const quarter = Math.round(beat * 4) % 2 !== 0;
    // Fine subdivisions require acoustic evidence, except short, energetic
    // sixteenth-note fills in the final beat of a phrase.
    if (
      quarter &&
      !onset &&
      !(energy > 0.78 && inPhrase >= 15 && intensity > 0.6)
    )
      continue;
    // Expert+ transforms the phrase's spatial motif as well as admitting
    // supported finer rhythm. It remains distinct when the song only has
    // half-beat acoustic events, without inventing unnecessary extra sounds.
    const motif =
      (phraseStyle(seed, phrase, style) + (level === 4 ? 1 : 0)) % 6;
    const base = profile.fill * (0.38 + density * 0.85) * (0.5 + energy * 0.55);
    const accent = downbeat ? 0.23 : onBeat ? 0.1 : 0;
    const evidence = onset ? onset.strength * 0.24 : 0;
    const phraseBreath = inPhrase >= 14 && energy < 0.5 ? 0.5 : 1;
    const probability = clamp((base + accent + evidence) * phraseBreath);
    if (noise(seed, Math.round(beat * 4), 7) > probability) continue;
    const available = (hand) =>
      time - hands[hand].time >= profile.handGap - 1e-6;
    let hand = nextHand;
    if (!available(hand)) hand = 1 - hand;
    if (!available(hand)) continue;
    const double =
      profile.doubles > 0 &&
      downbeat &&
      energy > 0.58 &&
      available(0) &&
      available(1) &&
      noise(seed, Math.round(beat * 4), 17) <
        profile.doubles * (0.4 + intensity);
    const activeHands = double ? [0, 1] : [hand];
    for (const color of activeHands) {
      const state = hands[color];
      const down = state.hits % 2 === 0;
      const phase = Math.floor(inPhrase / 2);
      let inner =
        level === 0 ||
        (phase + (motif % 2 ? color : 0) + motif) % (motif === 3 ? 4 : 3) === 0;
      if (style === "dance") inner = (phase + color + motif) % 4 < 2;
      if (style === "cinematic") inner = phase % 4 === 0;
      let x = color === 0 ? (inner ? 1 : 0) : inner ? 2 : 3;
      if (wallAt(walls, beat, x, (context.bpm / 60) * 0.25)) {
        inner = true;
        x = color === 0 ? 1 : 2;
      }
      // Face cells (1,1), (2,1) are never used. Top-row reaches are reserved
      // for higher difficulties, and upward cuts instead of wide down hits.
      let y = inner ? (!down && level >= 2 ? 2 : 0) : down ? 1 : 0;
      if (level === 0) y = 0;
      if (motif === 2 && level >= 3 && !down && !inner) y = 1;
      const diagonal =
        level >= 2 &&
        !double &&
        !inner &&
        noise(seed, phrase % 4, phase + color * 8) < 0.25 + intensity * 0.3;
      // Outward/down, inward/up arcs stay within each hand's half of the grid.
      const sign = down ? (color === 0 ? -1 : 1) : color === 0 ? 1 : -1;
      const direction = chooseDirection(state.direction, down, diagonal, sign);
      notes.push({ beat, x, y, color, direction });
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
  if (!controls.bombs || level < 1) return [];
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
  const maps = {};
  for (const [level, difficulty] of DIFFICULTIES.entries()) {
    const profile = PROFILES[difficulty];
    const obstacles = makeWalls(context, level, controls.seed, walls);
    const reservedBombs = makeBombs(context, [], obstacles, level, controls);
    const notes = makeNotes(
      context,
      profile,
      level,
      controls,
      obstacles,
      reservedBombs,
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
        version: 1,
        seed,
        density: controls.density,
        intensity: controls.intensity,
        style,
        minHandIntervalSeconds: profile.handGap,
        minNoteIntervalSeconds: profile.gap,
      },
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
