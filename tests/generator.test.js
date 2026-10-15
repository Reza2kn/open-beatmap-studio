import test from "node:test";
import assert from "node:assert/strict";
import {
  generateMaps,
  validateGameplay,
  DIFFICULTIES,
} from "../src/generator.js";

function musicalAnalysis({ bpm = 120, duration = 96, offset = 0.18 } = {}) {
  const step = 60 / bpm / 4;
  return {
    bpm,
    duration,
    offset,
    onsets: Array.from(
      { length: Math.floor((duration - offset) / step) },
      (_, i) => ({
        time: offset + i * step,
        strength: i % 16 === 0 ? 1 : 0.6,
        low: i % 4 === 0 ? 0.7 : 0.15,
        mid: 0.2,
        high: i % 2 ? 0.65 : 0.1,
      }),
    ),
    sections: [
      { start: 0, end: 24, energy: 0.3, label: "quiet" },
      { start: 24, end: 48, energy: 0.6, label: "build" },
      { start: 48, end: 72, energy: 0.95, label: "peak" },
      { start: 72, end: duration, energy: 0.5, label: "flow" },
    ],
  };
}

test("creates five distinct playable difficulties with increasing musical density", () => {
  const maps = generateMaps(musicalAnalysis());
  assert.deepEqual(Object.keys(maps), DIFFICULTIES);
  const counts = Object.values(maps).map((m) => m.notes.length);
  for (let i = 1; i < counts.length; i++)
    assert.ok(counts[i] > counts[i - 1], `${counts}`);
  assert.deepEqual(
    Object.values(maps).map((m) => m.rank),
    [1, 3, 5, 7, 9],
  );
  for (const [difficulty, map] of Object.entries(maps)) {
    assert.ok(map.notes.length > 0, difficulty);
    assert.equal(
      map.validation.valid,
      true,
      `${difficulty}: ${JSON.stringify(map.validation.errors)}`,
    );
    assert.equal(
      map.validation.warnings.length,
      0,
      `${difficulty}: ${JSON.stringify(map.validation.warnings)}`,
    );
    assert.ok(map.njs >= 10 && map.njs <= 18);
    assert.equal(map.difficulty, difficulty);
  }
});

test("same audio, controls and seed reproduce byte-identical maps without modifying analysis", () => {
  const analysis = musicalAnalysis();
  const original = structuredClone(analysis);
  const first = generateMaps(analysis, { seed: "a repeatable seed" });
  assert.deepEqual(
    first,
    generateMaps(analysis, { seed: "a repeatable seed" }),
  );
  assert.deepEqual(analysis, original);
  assert.notDeepEqual(
    first.Expert.notes,
    generateMaps(analysis, { seed: "a different seed" }).Expert.notes,
  );
});

test("ExpertPlus transforms choreography even when finer acoustic events are absent", () => {
  const analysis = musicalAnalysis();
  analysis.onsets = analysis.onsets.filter((_, index) => index % 2 === 0);
  const maps = generateMaps(analysis);
  const positions = (map) =>
    map.notes.map((n) => [n.beat, n.x, n.y, n.direction]);
  assert.notDeepEqual(positions(maps.Expert), positions(maps.ExpertPlus));
  assert.equal(maps.ExpertPlus.validation.valid, true);
});

test('observed syncopations retain exact attack times and override any coarse grid', () => {
  const times = [1.87, 2.19, 2.56, 3.13, 3.79, 4.17, 4.61, 5.28];
  const rhythmEvents = times.map((time, index) => ({ time, strength: .6 + index % 3 * .15,
    confidence: .9, kind: index % 2 ? 'snare' : 'kick', gridBeat: Math.round(time * 2), source: 'acoustic' }));
  const analysis = { bpm: 120, offset: .13, duration: 8, rhythmEvents,
    onsets: [2, 3, 4, 5], sections: [{ start: 0, end: 8, energy: .8 }] };
  const maps = generateMaps(analysis, { bombs: false, walls: false });
  for (const map of Object.values(maps)) {
    assert.ok(map.notes.length > 0);
    for (const note of map.notes) {
      const time = note.beat * 60 / analysis.bpm + analysis.offset;
      assert.ok(times.some(attack => Math.abs(attack - time) < .00004), `${map.difficulty}: ${time}`);
    }
    assert.equal(map.generation.timingSource, 'acoustic-attacks');
  }
  const shifted = generateMaps({ ...analysis, offset: -.27 }, { bombs: false, walls: false });
  assert.deepEqual([...new Set(maps.ExpertPlus.notes.map(n => Math.round((n.beat * .5 + .13) * 1000)))],
    [...new Set(shifted.ExpertPlus.notes.map(n => Math.round((n.beat * .5 - .27) * 1000)))]);
});

test('repeated syncopated rhythm repeats note rhythms; seed chooses movement rather than hits', () => {
  const phases = [0, .75, 1.5, 2, 2.75, 3.5];
  const onsets = Array.from({ length: 12 }, (_, bar) => phases.map((phase, index) => ({
    time: (bar * 4 + phase) * .5, strength: index % 3 === 0 ? 1 : .6,
    confidence: .9, kind: index % 3 === 0 ? 'kick' : 'snare', low: .7,
  }))).flat();
  const analysis = { bpm: 120, offset: 0, duration: 24, onsets,
    sections: [{ start: 0, end: 24, energy: .8 }] };
  const first = generateMaps(analysis, { seed: 42, bombs: false, walls: false });
  const second = generateMaps(analysis, { seed: 43, bombs: false, walls: false });
  for (const difficulty of DIFFICULTIES) {
    const map = first[difficulty];
    const rhythmInBar = bar => [...new Set(map.notes.filter(note => Math.floor(note.beat / 4) === bar)
      .map(note => Math.round((note.beat - bar * 4) * 1000)))];
    assert.deepEqual(rhythmInBar(4), rhythmInBar(8), difficulty);
    assert.deepEqual(map.notes.map(note => note.beat), second[difficulty].notes.map(note => note.beat), difficulty);
    assert.ok(map.generation.rhythmicSignatures <= 2, "one full rhythm plus the truncated introduction");
  }
  assert.notDeepEqual(first.Expert.notes, second.Expert.notes);
});

test('held sounds and empty detector output do not create metronome hits', () => {
  const held = { bpm: 120, offset: 0, duration: 20, energy: Array(20).fill(.8), frameDuration: 1, onsets: [] };
  for (const map of Object.values(generateMaps(held))) {
    assert.deepEqual(map.notes, []);
    assert.deepEqual(map.bombs, []);
    assert.deepEqual(map.obstacles, []);
  }
  for (const map of Object.values(generateMaps({ ...held, onsets: [{ time: 2.17, strength: .9 }] }))) {
    assert.equal(map.notes.length, 1);
    assert.ok(Math.abs(map.notes[0].beat * .5 - 2.17) < .00004);
    assert.deepEqual(map.bombs, []);
  }
  const synthetic = generateMaps({ bpm: 120, duration: 20, sections: [{ start: 0, end: 20, energy: .8 }] });
  assert.ok(synthetic.Expert.notes.length > 0);
  assert.equal(synthetic.Expert.generation.timingSource, 'synthetic-grid');
});

test("real demo DSP analysis preserves difficulty progression without excessive bomb pauses", async () => {
  const { createDemo } = await import("../src/media.js");
  const { analyzeAudio } = await import("../src/audio.js");
  const context = {
    createBuffer(numberOfChannels, length, sampleRate) {
      const channels = Array.from(
        { length: numberOfChannels },
        () => new Float32Array(length),
      );
      return {
        length,
        sampleRate,
        numberOfChannels,
        duration: length / sampleRate,
        getChannelData: (index) => channels[index],
      };
    },
  };
  const analysis = await analyzeAudio(createDemo(context), {
    bpmOverride: 128,
    offsetOverride: 0,
  });
  const maps = generateMaps(analysis);
  const counts = DIFFICULTIES.map(
    (difficulty) => maps[difficulty].notes.length,
  );
  for (let i = 1; i < counts.length; i++)
    assert.ok(counts[i] >= counts[i - 1], counts.join("/"));
  for (const map of Object.values(maps)) {
    assert.deepEqual(map.validation.errors, []);
    assert.deepEqual(map.validation.warnings, []);
    assert.ok(
      map.bombs.length <= 4,
      "bomb pauses should be sparse in a one-minute song",
    );
  }
});

test("density, style and intensity controls have observable effects", () => {
  const analysis = musicalAnalysis();
  const sparse = generateMaps(analysis, { density: 0, bombs: false });
  const dense = generateMaps(analysis, { density: 1, bombs: false });
  for (const key of DIFFICULTIES)
    assert.ok(dense[key].notes.length > sparse[key].notes.length, key);
  const dance = generateMaps(analysis, { style: "dance" }).Expert;
  const flow = generateMaps(analysis, { style: "flow" }).Expert;
  assert.notDeepEqual(dance.notes, flow.notes);
  const softLights = generateMaps(analysis, {
    intensity: 0,
  }).Expert.events.filter((e) => e.type <= 4);
  const vividLights = generateMaps(analysis, {
    intensity: 1,
  }).Expert.events.filter((e) => e.type <= 4);
  assert.ok(
    vividLights.reduce((sum, e) => sum + e.floatValue, 0) >
      softLights.reduce((sum, e) => sum + e.floatValue, 0),
  );
});

test("maps track section energy and leave actual silence empty", () => {
  const analysis = musicalAnalysis();
  analysis.sections = [
    { start: 0, end: 24, energy: 0.2 },
    { start: 24, end: 48, energy: 0.9 },
    { start: 48, end: 72, energy: 0 },
    { start: 72, end: 96, energy: 0.8 },
  ];
  const map = generateMaps(analysis, { bombs: false }).Expert;
  const atTime = (n) => (n.beat * 60) / analysis.bpm + analysis.offset;
  const quietCount = map.notes.filter(
    (n) => atTime(n) >= 2 && atTime(n) < 24,
  ).length;
  const peakCount = map.notes.filter(
    (n) => atTime(n) >= 24 && atTime(n) < 46,
  ).length;
  assert.ok(peakCount > quietCount);
  assert.equal(
    map.notes.filter((n) => atTime(n) >= 48 && atTime(n) < 72).length,
    0,
  );
  assert.equal(
    map.bombs.filter((n) => atTime(n) >= 48 && atTime(n) < 72).length,
    0,
  );
});

test("numeric energy frames and timestamped energy both preserve silent spans", () => {
  const base = musicalAnalysis({ duration: 24 });
  const energy = Array.from({ length: 24 }, (_, i) =>
    i >= 8 && i < 16 ? 0 : 0.8,
  );
  const variants = [
    { ...base, sections: [], energy, frameDuration: 1 },
    {
      ...base,
      sections: [],
      energy: energy.map((value, time) => ({ time, value })),
    },
  ];
  for (const analysis of variants) {
    const maps = generateMaps(analysis);
    for (const map of Object.values(maps)) {
      const notesInSilence = map.notes.filter((n) => {
        const time = (n.beat * 60) / analysis.bpm + analysis.offset;
        return time >= 8 && time < 16;
      });
      assert.equal(notesInSilence.length, 0);
    }
  }
});

test("hazards are sparse, visible, optional and separated from all cuts", () => {
  const analysis = musicalAnalysis({ duration: 160 });
  // Genuine phrase-tail pauses make room for hazards. The generator must not
  // remove observed musical attacks merely to force a bomb into a dense song.
  analysis.onsets = analysis.onsets.filter(onset => {
    const beat = (onset.time - analysis.offset) * analysis.bpm / 60;
    return Math.abs(((beat + 1) % 32 + 32) % 32) > 1.6 && Math.abs(((beat + 1) % 32 + 32) % 32 - 32) > 1.6;
  });
  const maps = generateMaps(analysis);
  assert.equal(maps.Easy.bombs.length, 0);
  for (const map of Object.values(maps)) {
    if (map.difficulty !== "Easy") assert.ok(map.bombs.length > 0);
    for (const b of map.bombs) {
      for (const n of map.notes)
        assert.ok((Math.abs(n.beat - b.beat) * 60) / map.bpm >= 0.65 - 0.001);
      assert.ok(
        map.events.some(
          (e) =>
            e.type === 4 &&
            e.value > 0 &&
            e.beat <= b.beat &&
            e.beat >= b.beat - 1,
        ),
      );
    }
    for (const w of map.obstacles) {
      assert.ok(w.width === 1 && (w.x === 0 || w.x === 3));
      assert.ok((w.duration * 60) / map.bpm <= 1.11);
      assert.equal(
        map.notes.some(
          (n) =>
            n.x === w.x && n.beat >= w.beat && n.beat <= w.beat + w.duration,
        ),
        false,
      );
    }
  }
  const noHazards = generateMaps(musicalAnalysis(), {
    walls: false,
    bombs: false,
    lights: false,
  });
  for (const map of Object.values(noHazards)) {
    assert.deepEqual(map.bombs, []);
    assert.deepEqual(map.obstacles, []);
    assert.deepEqual(map.events, []);
  }
});

test("all notes stay inside the song, respect the manual offset and avoid face cells", () => {
  const analysis = musicalAnalysis({ offset: -0.31, bpm: 137 });
  for (const map of Object.values(generateMaps(analysis))) {
    assert.equal(map.offset, -0.31);
    assert.equal(map.bpm, 137);
    for (const n of map.notes) {
      const time = analysis.offset + (n.beat * 60) / analysis.bpm;
      assert.ok(time >= 1.249 - 0.001 && time <= analysis.duration - 0.449);
      assert.ok(n.color === 0 ? n.x <= 1 : n.x >= 2);
      assert.ok(n.y !== 1 || n.x === 0 || n.x === 3);
    }
  }
});

test("real-time swing limits survive tempo, seed and style variation", () => {
  for (const bpm of [30, 55, 87, 120, 173, 240, 400]) {
    for (const seed of [1, 12, 42, "night drive"]) {
      for (const style of ["flow", "dance", "technical", "cinematic"]) {
        const maps = generateMaps(musicalAnalysis({ bpm, duration: 36 }), {
          seed,
          style,
          density: 1,
          intensity: 1,
        });
        for (const [difficulty, map] of Object.entries(maps)) {
          const diagnostics = validateGameplay(map);
          assert.deepEqual(
            diagnostics.errors,
            [],
            `${bpm} BPM, ${seed}, ${style}, ${difficulty}`,
          );
          assert.deepEqual(
            diagnostics.warnings,
            [],
            `${bpm} BPM, ${seed}, ${style}, ${difficulty}`,
          );
        }
      }
    }
  }
});

test("lighting is sorted and contains portable colored pulses, movement and a final blackout", () => {
  const map = generateMaps(musicalAnalysis()).Hard;
  for (let i = 1; i < map.events.length; i++)
    assert.ok(map.events[i].beat >= map.events[i - 1].beat);
  assert.ok(map.events.some((e) => e.type === 8));
  assert.ok(map.events.some((e) => e.type === 12));
  assert.ok(
    map.events.some((e) => e.type <= 4 && e.value >= 5 && e.value <= 7),
  );
  assert.equal(map.events.filter((e) => e.type <= 4 && e.value >= 9).length, 0);
  assert.deepEqual(
    map.events.slice(-5).map((e) => [e.type, e.value, e.floatValue]),
    [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
      [4, 0, 0],
    ],
  );
});

test("empty and tiny audio do not fabricate notes or hazards", () => {
  for (const duration of [0.1, 1, 4]) {
    const maps = generateMaps({
      bpm: 120,
      duration,
      energy: [0],
      frameDuration: duration,
      onsets: [],
    });
    for (const map of Object.values(maps)) {
      assert.equal(map.notes.length, 0);
      assert.equal(map.bombs.length, 0);
      assert.equal(map.obstacles.length, 0);
      assert.equal(map.validation.valid, true);
    }
  }
});

test("rejects invalid tempo/duration instead of producing corrupt beat positions", () => {
  for (const bpm of [undefined, NaN, Infinity, 0, -10, 401])
    assert.throws(() => generateMaps({ bpm, duration: 10 }), /BPM/);
  for (const duration of [undefined, NaN, Infinity, 0, -1])
    assert.throws(() => generateMaps({ bpm: 120, duration }), /duration/);
  assert.throws(() => generateMaps({ bpm: 120, duration: 7201 }), /trim/);
});

test("static validator catches overlaps, rapid repeats, parity, unsafe walls and handclaps", () => {
  const map = {
    bpm: 120,
    duration: 10,
    notes: [
      { beat: 1, x: 1, y: 1, color: 0, direction: 3 },
      { beat: 1, x: 2, y: 1, color: 1, direction: 2 },
      { beat: 1, x: 1, y: 1, color: 0, direction: 3 },
      { beat: 1.1, x: 0, y: 0, color: 0, direction: 3 },
    ],
    bombs: [{ beat: 1, x: 1, y: 1 }],
    obstacles: [{ beat: 0.5, x: 0, y: 0, width: 3, height: 5, duration: 2 }],
  };
  const result = validateGameplay(map);
  assert.equal(result.valid, false);
  const errors = result.errors.map((e) => e.code);
  for (const code of [
    "note-collision",
    "rapid-hand-repeat",
    "note-bomb-collision",
    "unsafe-wall",
    "note-wall-collision",
    "bomb-wall-collision",
    "handclap",
  ])
    assert.ok(errors.includes(code), code);
  const warnings = result.warnings.map((e) => e.code);
  for (const code of ["face-note", "parity-break", "bomb-swing-window"])
    assert.ok(warnings.includes(code), code);
  assert.deepEqual(
    validateGameplay({ notes: [], bombs: [], obstacles: [] }).errors,
    [],
  );
});
