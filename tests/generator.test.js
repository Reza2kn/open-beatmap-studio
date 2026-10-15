import test from "node:test";
import assert from "node:assert/strict";
import {
  generateMaps,
  validateGameplay,
  DIFFICULTIES,
  getRhythmAnchors,
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

function pulseFixture({ varying = false } = {}) {
  const beats = [.2];
  for (let i = 1; i < 64; i++) beats.push(beats.at(-1) + (varying ? .42 + i * .006 : .6));
  const duration = beats.at(-1) + .6;
  return { bpm: 100, offset: .2, duration, modelBeatTimes: beats, beatSource: 'learned',
    onsets: Array.from({ length: 80 }, (_, index) => ({ time: 1.31 + index * .371, strength: 1, confidence: 1, kind: 'mid' })),
    sections: [{ start: 0, end: duration, energy: .8 }] };
}

function grooveFixture() {
  const analysis = pulseFixture();
  analysis.percussionEvents = [];
  analysis.melodicEvents = analysis.modelBeatTimes.slice(0,16).map(time => ({ time, strength: .7, confidence: .95, kind: 'melodic' }));
  // Hand-authored truth: piano for four bars, followed by the eight-attack
  // kick/snare groove. Quarter beats 1 and 3 are actual kicks in this fixture.
  const phases = [0, .75, 1, 1.5, 2, 2.75, 3, 3.5];
  for (let bar = 4; bar < 16; bar++) for (const phase of phases) {
    analysis.percussionEvents.push({ time: .2 + (bar * 4 + phase) * .6,
      strength: Number.isInteger(phase) ? 1 : .75, confidence: .95,
      kind: Number.isInteger(phase) ? 'kick' : 'snare', percussiveRatio: .9 });
  }
  return analysis;
}

const absoluteTimes = (map, analysis) => [...new Set(map.notes.map(note => Math.round((note.beat * 60 / analysis.bpm + analysis.offset) * 10000) / 10000))];

test('known musical pulse wins over unrelated broadband/vocal attacks', () => {
  const analysis = pulseFixture();
  const maps = generateMaps(analysis, { bombs: false, walls: false });
  const expected = analysis.modelBeatTimes.filter(time => time >= 1.25 && time <= analysis.duration - .45);
  for (const difficulty of ['Normal', 'Hard', 'Expert', 'ExpertPlus']) {
    const times = absoluteTimes(maps[difficulty], analysis);
    assert.equal(times.length, expected.length);
    for (const time of expected) assert.ok(times.some(actual => Math.abs(actual - time) < .0001), `${difficulty}: ${time}`);
    assert.equal(maps[difficulty].rhythmDiagnostics.mode, 'pulse-fallback');
    assert.equal(maps[difficulty].rhythmDiagnostics.backboneCoverage, 1);
  }
  const easy = absoluteTimes(maps.Easy, analysis);
  for (let index = 1; index < easy.length; index++) assert.ok(Math.abs(easy[index] - easy[index - 1] - .6) < .0002);
  assert.equal(maps.Easy.rhythmDiagnostics.subdivisionCount, 0);
});

test('steady learned pulse removes jitter and missed beats, without following a half-beat glitch', () => {
  const analysis = pulseFixture();
  const truth = [...analysis.modelBeatTimes];
  analysis.modelBeatTimes = analysis.modelBeatTimes.filter((_, index) => index !== 10).map((time, index) => time + (index % 2 ? .006 : -.006));
  analysis.modelBeatTimes.push(truth[15] + .3);
  analysis.modelBeatTimes.sort((a,b)=>a-b);
  const map = generateMaps(analysis, { bombs: false, walls: false }).Normal;
  assert.equal(map.rhythmDiagnostics.pulseSmoothed, true);
  const times = absoluteTimes(map, analysis);
  for (const time of truth.filter(time => time >= 1.25 && time <= analysis.duration - .45)) assert.ok(times.some(actual => Math.abs(actual-time) < .003));
  assert.ok(times.every(time => truth.some(beat => Math.abs(time-beat) < .003)));
});

test('variable-tempo learned beats remain varying rather than forced onto one straight line', () => {
  const analysis = pulseFixture({ varying: true });
  const map = generateMaps(analysis, { bombs: false, walls: false }).Normal;
  assert.equal(map.rhythmDiagnostics.pulseSmoothed, false);
  const times = absoluteTimes(map, analysis);
  for (const beat of analysis.modelBeatTimes.filter(time=>time>=1.25&&time<=analysis.duration-.45)) assert.ok(times.some(time=>Math.abs(time-beat)<.0001));
  const intervals = times.slice(1).map((time,index)=>time-times[index]);
  assert.ok(Math.max(...intervals)-Math.min(...intervals) > .2);
});

test('piano intro transitions into the known drum groove without metronome filler', () => {
  const analysis = grooveFixture();
  // A six-attack variation has no kicks on beats 1 and 3: those must never be
  // manufactured just to achieve a high quarter-pulse coverage statistic.
  analysis.percussionEvents = analysis.percussionEvents.filter(event => Math.abs(((event.time-.2)/.6)%4-1)>.01 && Math.abs(((event.time-.2)/.6)%4-3)>.01);
  const map = generateMaps(analysis, { bombs: false, walls: false }).Hard;
  const times = absoluteTimes(map, analysis);
  assert.equal(map.rhythmDiagnostics.mode, 'percussion-groove');
  assert.ok(times.some(time=>time<9.8), 'the observed piano introduction is mapped');
  const actualDrums = analysis.percussionEvents.map(event=>event.time);
  for (const time of times.filter(time=>time>=9.8)) assert.ok(actualDrums.some(drum=>Math.abs(drum-time)<.0001), `${time} is not a drum`);
  for (const bar of [5,6,7]) {
    const expected = [0,.75,1.5,2,2.75,3.5].map(phase=>.2+(bar*4+phase)*.6);
    for (const beat of expected) assert.ok(times.some(time=>Math.abs(time-beat)<.0001));
  }
  assert.ok(map.rhythmDiagnostics.pulseCoverage < 1, 'quarter coverage is not a drum-groove quality target');
});

test('the recalibrated Easy keeps the stronger snare during a playability conflict', () => {
  const analysis = grooveFixture();
  const strong = [], weak = [];
  for (let bar=4;bar<15;bar++) {
    const time=.2+(bar*4+1.5)*.6;
    strong.push(time); weak.push(time-.12);
    analysis.percussionEvents.push({time:time-.12,strength:.46,confidence:.95,kind:'snare',percussiveRatio:.9});
  }
  analysis.percussionEvents.sort((a,b)=>a.time-b.time);
  const map=generateMaps(analysis,{bombs:false,walls:false}).Easy;
  const times=absoluteTimes(map,analysis);
  for(const time of strong)assert.ok(times.some(actual=>Math.abs(actual-time)<.0001));
  for(const time of weak)assert.ok(!times.some(actual=>Math.abs(actual-time)<.0001));
  assert.deepEqual(map.validation.errors,[]);
});

test('trusted isolated drum stems retain quiet real snares and canonicalize hats', () => {
  const analysis=grooveFixture();
  analysis.percussionSource='demucs-htdemucs';
  analysis.percussionEvents=analysis.percussionEvents.map(event=>({...event,strength:event.strength*.2,source:'demucs-htdemucs'}));
  for(let bar=4;bar<16;bar++)analysis.percussionEvents.push({time:.2+(bar*4+.5)*.6,strength:.1,confidence:.9,kind:'hat',source:'demucs-htdemucs'});
  analysis.percussionEvents.sort((a,b)=>a.time-b.time);
  const maps=generateMaps(analysis,{bombs:false,walls:false});
  assert.equal(maps.Hard.rhythmDiagnostics.percussionSource,'isolated-drums');
  assert.ok(maps.Hard.notes.some(note=>note.musicalRole==='snare'&&note.sourceTime>10));
  assert.ok(maps.Expert.notes.some(note=>note.musicalRole==='high'));
  assert.ok(maps.Hard.notes.some(note=>note.musicalRole==='high'));
  for(const note of maps.Expert.notes)assert.ok(Math.abs(note.sourceTime-(note.beat*.6+.2))<.0001);
});

test('independent stem activity ranges keep drum leakage out of a piano introduction', () => {
  const analysis=grooveFixture();analysis.percussionSource='demucs-htdemucs';
  analysis.drumQuality={activeRanges:[{start:9.8,end:analysis.duration}]};
  for(let beat=2;beat<16;beat++)analysis.percussionEvents.push({time:.2+beat*.6,strength:1,confidence:.95,kind:'kick',source:'demucs-htdemucs'});
  analysis.percussionEvents.sort((a,b)=>a.time-b.time);
  const map=generateMaps(analysis,{bombs:false,walls:false}).Hard;
  const introduction=map.notes.filter(note=>note.sourceTime<9.8);
  assert.ok(introduction.length>0);
  assert.ok(introduction.every(note=>note.musicalRole==='melodic'));
  assert.ok(map.notes.some(note=>note.sourceTime>10&&note.musicalRole==='kick'));
});

test('repeated drum grooves repeat note rhythms and seeds affect movement rather than hits', () => {
  const analysis=grooveFixture();
  const first=generateMaps(analysis,{seed:42,bombs:false,walls:false});
  const second=generateMaps(analysis,{seed:43,bombs:false,walls:false});
  for(const difficulty of DIFFICULTIES){
    const map=first[difficulty];
    const inBar=bar=>absoluteTimes(map,analysis).filter(time=>time>=.2+bar*4*.6-.0001&&time<.2+(bar+1)*4*.6-.0001)
      .map(time=>Math.round((time-(.2+bar*4*.6))/.6*1000));
    assert.deepEqual(inBar(5),inBar(6),difficulty);
    assert.deepEqual(map.notes.map(note=>note.beat),second[difficulty].notes.map(note=>note.beat),difficulty);
  }
  assert.notDeepEqual(first.Expert.notes,second.Expert.notes);
  const anchors=getRhythmAnchors(analysis);
  assert.ok(anchors.some(event=>!event.isPulse&&event.kind==='snare'));
});

test('held sounds, empty percussion, and isolated weak intro transients do not create a drum groove', () => {
  const held={bpm:120,offset:0,duration:20,energy:Array(20).fill(.8),frameDuration:1,onsets:[]};
  for(const map of Object.values(generateMaps(held)))assert.deepEqual(map.notes,[]);
  for(const map of Object.values(generateMaps({...held,onsets:[{time:2.17,strength:.9}]})))assert.deepEqual(map.notes,[]);
  const analysis=pulseFixture();analysis.percussionEvents=analysis.modelBeatTimes.map(time=>({time,strength:.25,confidence:.95,kind:'kick',percussiveRatio:.6}));analysis.melodicEvents=[];
  for(const map of Object.values(generateMaps(analysis))){assert.deepEqual(map.notes,[]);assert.deepEqual(map.rhythmDiagnostics.drumWindows,[]);}
  const synthetic=generateMaps({bpm:120,duration:20,sections:[{start:0,end:20,energy:.8}]});
  assert.ok(synthetic.Expert.notes.length>0);
  assert.ok(synthetic.Expert.generation.timingSource.startsWith('synthetic-'));
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
    assert.ok(dense[key].notes.length >= sparse[key].notes.length, key);
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
  analysis.percussionEvents = analysis.onsets.map(event => ({ ...event, strength: 1, confidence: .95, kind: 'snare' }));
  analysis.melodicEvents = [];
  analysis.modelBeatTimes = Array.from({length:Math.floor(analysis.duration*2)},(_,index)=>analysis.offset+index*.5);
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


test('Easy preserves the former Hard timing baseline on a controlled full groove', () => {
  const analysis=grooveFixture();analysis.percussionSource='demucs-htdemucs';
  for(let bar=4;bar<16;bar++)for(const phase of [.5,1.25,2.5,3.25])analysis.melodicEvents.push({time:.2+(bar*4+phase)*.6,kind:'melodic',strength:.6,confidence:.9});
  const maps=generateMaps(analysis,{walls:false,bombs:false});
  // This manually specified twelve-hit bar was the old Hard rhythm. It must
  // survive the new Easy tier, rather than falling back to two kicks per bar.
  const baseline=[0,.5,.75,1,1.25,1.5,2,2.5,2.75,3,3.25,3.5];
  for(const bar of [5,6,7,8,9,10,11,12,13,14]) {
    const expected=baseline.map(phase=>Math.round((.2+(bar*4+phase)*.6)*10000)/10000);
    const actual=absoluteTimes(maps.Easy,analysis).filter(time=>time>=.2+bar*4*.6-.0001&&time<.2+(bar+1)*4*.6-.0001);
    assert.deepEqual(actual,expected,`bar ${bar}`);
  }
  assert.equal(maps.Easy.generation.difficultyCalibration,'full-groove-baseline');
  assert.equal(maps.Easy.generation.minHandIntervalSeconds,.28);
  assert.equal(maps.Easy.generation.minNoteIntervalSeconds,.14);
  for(const map of Object.values(maps)) {
    const times=new Set(map.notes.map(note=>note.sourceTime));
    for(const time of maps.Easy.notes.map(note=>note.sourceTime))assert.ok(times.has(time),`${map.difficulty} retains Easy's groove`);
    assert.deepEqual(map.validation.errors,[]);
    assert.deepEqual(map.validation.warnings,[]);
  }
});

test('harder levels cover more real percussion and layered melody without adding filler hits',()=>{
  const a=grooveFixture();a.percussionSource='demucs-htdemucs';
  for(let bar=4;bar<16;bar++) {
    for(let tick=0;tick<32;tick++) {
      if(tick%8===0 || [.5,1.25,2.5,3.25].includes(tick/8))continue;
      a.percussionEvents.push({time:.2+(bar*4+tick/8)*.6,kind:'hat',detail:true,strength:.7,confidence:.9,source:'demucs-htdemucs-band'});
    }
    for(const phase of [.5,1.25,2.5,3.25])a.melodicEvents.push({time:.2+(bar*4+phase)*.6,kind:'melodic',strength:.6,confidence:.9});
  }
  const maps=generateMaps(a,{walls:false,bombs:false});
  const count=d=>new Set(maps[d].notes.map(n=>n.beat)).size;
  const counts=DIFFICULTIES.map(count);
  for(let index=1;index<counts.length;index++)assert.ok(counts[index]>=counts[index-1],counts.join('/'));
  assert.ok(count('Easy')>=140,'Easy starts with the full former-Hard groove');
  assert.ok(count('Expert')>=count('Hard'), 'Expert retains Hard when the supported 16th-note grid is already full');
  assert.ok(count('ExpertPlus')>count('Expert')*1.15);
  assert.ok(maps.Expert.notes.some(n=>n.timingRole==='melodic-layer'));
  assert.ok(maps.ExpertPlus.notes.some(n=>Math.abs(((n.sourceTime-.2)/.6)*4-Math.round(((n.sourceTime-.2)/.6)*4))>.1),'Expert+ includes supported 32nd percussion');
  const sources=[...a.percussionEvents,...a.melodicEvents].map(e=>e.time);
  for(const map of Object.values(maps)) {
    assert.equal(map.validation.valid,true,JSON.stringify(map.validation.errors));
    for(const note of map.notes)assert.ok(sources.some(t=>Math.abs(t-note.sourceTime)<.00001));
  }
});

test('Expert+ can use quiet isolated instrument fills while rejecting unaligned attacks',()=>{
  const a=grooveFixture();a.percussionSource='demucs-htdemucs';
  const real=.2+(9*4+1.25)*.6, unaligned=.2+(9*4+1.07)*.6;
  for(const time of [real,unaligned])a.melodicEvents.push({time,kind:'melodic',strength:.04,confidence:.8,source:'demucs-htdemucs-other'});
  const maps=generateMaps(a,{walls:false,bombs:false});
  assert.ok(maps.ExpertPlus.notes.some(n=>Math.abs(n.sourceTime-real)<.00001));
  assert.ok(!maps.ExpertPlus.notes.some(n=>Math.abs(n.sourceTime-unaligned)<.00001));
  for(const d of ['Easy','Normal','Hard','Expert'])assert.ok(!maps[d].notes.some(n=>Math.abs(n.sourceTime-real)<.00001));
});


test('higher tiers add quiet proven piano phases without promoting broadband or vocal leakage', () => {
  const analysis=grooveFixture();analysis.percussionSource='demucs-htdemucs';
  const piano=[],noise=[];
  for(let bar=4;bar<15;bar++) {
    const real=.2+(bar*4+1.25)*.6,bad=.2+(bar*4+.5)*.6;
    piano.push(real);noise.push(bad);
    analysis.melodicEvents.push({time:real,strength:.04,confidence:.9,kind:'melodic',source:'demucs-htdemucs-other',instrumentMethod:'tonal-attacks-vocal-veto',tonalConfidence:.98,attackContrast:3,spectralChange:.4,vocalDominance:.2,vocalCoherence:.01});
    analysis.melodicEvents.push({time:bad,strength:1,confidence:.99,kind:'melodic',source:'demucs-htdemucs-other',instrumentMethod:'tonal-attacks-vocal-veto',tonalConfidence:.1,attackContrast:5,spectralChange:.6,vocalDominance:8,vocalCoherence:.9});
  }
  const maps=generateMaps(analysis,{walls:false,bombs:false});
  assert.ok(!maps.Easy.notes.some(note=>piano.includes(note.sourceTime)));
  assert.ok(maps.Normal.notes.some(note=>piano.includes(note.sourceTime)));
  for(const map of Object.values(maps)) {
    assert.ok(!map.notes.some(note=>noise.includes(note.sourceTime)));
    assert.deepEqual(map.validation.errors,[]);
  }
});
