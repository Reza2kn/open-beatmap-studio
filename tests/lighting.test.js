import test from "node:test";
import assert from "node:assert/strict";
import { generateLightshow, LIGHTING_ENVIRONMENT } from "../src/lighting.js";

function song({ band = "bass", offset = 0.2, bpm = 120, duration = 48 } = {}) {
  const energy = Array.from({ length: Math.ceil(duration * 20) }, (_, i) =>
    i < 160 ? 0.08 : i < 320 ? 0.4 : i < 640 ? 0.92 : 0.38,
  );
  const onsets = [];
  for (let time = offset; time < duration; time += 60 / bpm / 2)
    onsets.push({
      time,
      strength: 0.9,
      low: band === "bass" ? 0.85 : 0.08,
      mid: 0.07,
      high: band === "treble" ? 0.85 : 0.08,
    });
  return {
    bpm,
    offset,
    duration,
    frameDuration: 0.05,
    energy,
    onsets,
    sections: [
      { start: 0, end: 8, energy: 0.08, label: "quiet" },
      { start: 8, end: 16, energy: 0.4, label: "build" },
      { start: 16, end: 32, energy: 0.92, label: "peak" },
      { start: 32, end: duration, energy: 0.38, label: "flow" },
    ],
  };
}

test("native lightshow uses verified Weave groups, two moving axes and no invented translation", () => {
  const show = generateLightshow(song());
  assert.equal(show.environment, "WeaveEnvironment");
  assert.equal(LIGHTING_ENVIRONMENT.groups[12].count, 12);
  assert.equal(LIGHTING_ENVIRONMENT.groups[0].count, 8);
  assert.ok(show.lightColorEventBoxGroups.length > 100);
  assert.ok(show.lightRotationEventBoxGroups.length > 50);
  assert.deepEqual(show.lightTranslationEventBoxGroups, []);
  assert.deepEqual(
    [...new Set(show.lightColorEventBoxGroups.map((g) => g.g))].sort(
      (a, b) => a - b,
    ),
    Array.from({ length: 16 }, (_, i) => i),
  );
  assert.deepEqual(
    [
      ...new Set(
        show.lightRotationEventBoxGroups.flatMap((g) =>
          g.e.map((box) => box.a),
        ),
      ),
    ].sort(),
    [0, 1],
  );
  assert.ok(
    show.lightColorEventBoxGroups.some((g) =>
      g.e.some((box) => box.w > 0 && box.r < 0),
    ),
    "spatial waves and brightness gradients",
  );
  assert.ok(
    show.lightColorEventBoxGroups.some(
      (g) => g.e.length === 2 && g.e[0].e[0].c !== g.e[1].e[0].c,
    ),
    "complementary spatial color halves",
  );
  assert.equal(show.stats.strobeEvents, 0);
});

test("nested relative event times and wave tails remain within the audio with a nonzero offset", () => {
  const analysis = song({ bpm: 137, offset: -0.13, duration: 21.3 });
  const show = generateLightshow(analysis);
  for (const [groups, eventKey] of [
    [show.lightColorEventBoxGroups, "e"],
    [show.lightRotationEventBoxGroups, "l"],
  ]) {
    let previous = -Infinity;
    for (const group of groups) {
      assert.ok(group.b >= previous);
      previous = group.b;
      const absolute = analysis.offset + (group.b * 60) / analysis.bpm;
      assert.ok(absolute >= -1e-4);
      for (const box of group.e) {
        assert.equal(box.d, 1);
        assert.ok(box.f.p >= 1 && box.f.t >= 0 && box.f.t < box.f.p);
        for (const event of box[eventKey]) {
          assert.ok(event.b >= 0);
          assert.ok(
            absolute + ((event.b + box.w) * 60) / analysis.bpm <=
              analysis.duration + 1e-4,
          );
          if (eventKey === "e") {
            assert.equal(event.f, 0);
            assert.ok(event.s >= 0 && event.s <= 1);
          } else {
            assert.ok(event.r >= 0 && event.r < 360);
            assert.equal(event.l, 0);
          }
        }
      }
    }
  }
  for (const cue of show.previewCues)
    assert.ok(cue.time >= 0 && cue.time < analysis.duration);
});

test("same seed repeats exactly, changed seed changes movement and phrase identity", () => {
  const analysis = song(),
    copy = JSON.stringify(analysis);
  assert.deepEqual(
    generateLightshow(analysis, { seed: "open" }),
    generateLightshow(analysis, { seed: "open" }),
  );
  assert.notDeepEqual(
    generateLightshow(analysis, { seed: "open" }),
    generateLightshow(analysis, { seed: "beat" }),
  );
  assert.equal(JSON.stringify(analysis), copy, "analysis is not mutated");
});

test("instrument balance changes choreography even when tempo and energy stay constant", () => {
  const bass = generateLightshow(song({ band: "bass" }));
  const treble = generateLightshow(song({ band: "treble" }));
  assert.ok(bass.previewCues.some((c) => c.bass > 0.6 && c.impact > 0.5));
  assert.ok(treble.previewCues.some((c) => c.treble > 0.6));
  assert.notDeepEqual(
    bass.lightColorEventBoxGroups,
    treble.lightColorEventBoxGroups,
  );
  assert.ok(new Set(bass.previewCues.map((c) => c.pattern)).size >= 5);
  for (const phase of ["quiet", "build", "drop", "peak", "flow", "end"])
    assert.ok(bass.stats.phases.includes(phase), phase);
});

test("disabled/silent lighting is empty, zero motion removes movement, reduced intensity dims the show", () => {
  const analysis = song();
  for (const show of [
    generateLightshow(analysis, { enabled: false }),
    generateLightshow({ ...analysis, silent: true }),
    generateLightshow(analysis, { intensity: 0 }),
  ]) {
    assert.deepEqual(show.lightColorEventBoxGroups, []);
    assert.deepEqual(show.previewCues, []);
  }
  assert.deepEqual(
    generateLightshow(analysis, { motion: 0 }).lightRotationEventBoxGroups,
    [],
  );
  const dim = generateLightshow(analysis, { intensity: 0.2 }),
    bright = generateLightshow(analysis, { intensity: 0.8 });
  assert.ok(
    dim.previewCues.reduce((n, c) => n + c.brightness, 0) <
      bright.previewCues.reduce((n, c) => n + c.brightness, 0),
  );
});

test("silence passages reach a full blackout and the final events turn every group off", () => {
  const analysis = song();
  analysis.energy.fill(0, 650, 800);
  const show = generateLightshow(analysis);
  // Existing acoustic onsets are genuine accents; remove them for a true rest.
  const quiet = generateLightshow({
    ...analysis,
    onsets: analysis.onsets.filter((o) => o.time < 32.5 || o.time > 40),
  });
  assert.ok(
    quiet.previewCues.some(
      (c) =>
        c.time > 33 &&
        c.time < 39 &&
        c.brightness === 0 &&
        c.groups.length === 16,
    ),
  );
  assert.equal(show.lightColorEventBoxGroups.slice(-16).length, 16);
  for (const group of show.lightColorEventBoxGroups.slice(-16))
    assert.ok(
      group.e.every(
        (box) => box.r === 0 && box.e.every((event) => event.s === 0),
      ),
    );
  assert.equal(show.previewCues.at(-1).pattern, "blackout");
});

test("dense crescendos are thinned without chaining all accents into one cue", () => {
  const analysis = song();
  analysis.onsets = Array.from({ length: 480 }, (_, i) => ({
    time: i * 0.1,
    strength: 0.2 + i / 600,
    low: 0.8,
    mid: 0.1,
    high: 0.1,
  }));
  const show = generateLightshow(analysis);
  const cues = show.previewCues.filter((c) => c.phase !== "end");
  assert.ok(cues.length > 100);
  for (let i = 1; i < cues.length; i++)
    assert.ok(cues[i].time - cues[i - 1].time >= 0.2199);
});

test("input timing is validated", () => {
  assert.throws(() => generateLightshow({ duration: 0, bpm: 120 }), /duration/);
  assert.throws(() => generateLightshow({ duration: 30, bpm: NaN }), /BPM/);
});

test("arranged kick and syncopated snare keep their distinct light accents", () => {
  const analysis = song({ offset: 0, bpm: 120, duration: 12 });
  analysis.beatTimes = Array.from({length:24},(_,i)=>i*.5);
  analysis.lightRhythmEvents = [
    {time:2.375,strength:1,kind:'snare',mid:.9,low:.05,high:.05},
    {time:2.5,strength:1,kind:'kick',low:.9,mid:.05,high:.05},
  ];
  const cues=generateLightshow(analysis).previewCues;
  assert.ok(cues.some(c=>Math.abs(c.time-2.375)<.002));
  assert.ok(cues.some(c=>Math.abs(c.time-2.5)<.002));
});
