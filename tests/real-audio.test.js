import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeAudio } from "../src/audio.js";
import { generateMaps } from "../src/generator.js";
import { applyBeatModel } from "../src/beat-model.js";
import {
  fixtureConfig,
  decodeAudioFile,
  sha256File,
  percentile,
  nearestDistance,
} from "../tools/audio-fixture.mjs";
const fixture = fixtureConfig();
const noteTimes = (map, analysis) => [...new Set(map.notes.map((note) =>
  analysis.offset + note.beat * 60 / analysis.bpm,
))].sort((a, b) => a - b);
function referenceSubdivisions(times) {
  const output = [];
  for (let i = 0; i + 1 < times.length; i++)
    for (let slot = 0; slot < 4; slot++)
      output.push(times[i] + (times[i + 1] - times[i]) * slot / 4);
  return output;
}
test(
  "configured private recording: DSP phase and independent learned pulse fallback",
  {
    skip: !fixture.audioPath
      ? "Set BEATMAP_TEST_AUDIO or .local-tests/audio-fixture.json; no copyrighted song is bundled."
      : false,
  },
  async (t) => {
    if (fixture.sha256)
      assert.equal(
        sha256File(fixture.audioPath),
        fixture.sha256,
        "The regression must use the exact supplied recording.",
      );
    const buffer = decodeAudioFile(fixture.audioPath),
      analysis = await analyzeAudio(buffer);
    if (fixture.expectedBpm)
      assert.ok(
        Math.abs(analysis.bpm - fixture.expectedBpm) < 0.015,
        `BPM ${analysis.bpm}`,
      );
    if (fixture.referencePath) {
      const reference = JSON.parse(readFileSync(fixture.referencePath, "utf8"));
      const [start, end] = reference.reliableRangeSeconds;
      const period = 60 / analysis.bpm;
      const errors = reference.times
        .filter((t) => t >= start && t <= end)
        .map((t) =>
          Math.abs(
            ((((t - analysis.offset + period / 2) % period) + period) %
              period) -
              period / 2,
          ),
        );
      assert.ok(
        percentile(errors, 0.5) < 0.015,
        `Model-reference median ${percentile(errors, 0.5)} s`,
      );
      assert.ok(
        percentile(errors, 0.9) < 0.035,
        `Model-reference p90 ${percentile(errors, 0.9)} s`,
      );
    }
    // Audio structure remains checked for the DSP fallback, without claiming
    // that matching its own detected attacks independently proves sync.
    for (const [name, map] of Object.entries(generateMaps(analysis))) {
      assert.equal(
        map.validation.valid,
        true,
        `${name}: ${JSON.stringify(map.validation.errors)}`,
      );
      assert.ok(noteTimes(map, analysis).every((time) =>
        Number.isFinite(time) && time >= 0 && time < analysis.duration,
      ));
      assert.ok(map.notes.length > 20);
    }

    await t.test("stored isolated instruments give harder profiles distinct, denser supported hit times", {
      skip: !fixture.layeredModelResultPath ? "No local layered model fixture configured." : false,
    },()=>{
      const result=JSON.parse(readFileSync(fixture.layeredModelResultPath,"utf8"));
      const layered=applyBeatModel(analysis,result), maps=generateMaps(layered);
      const counts=Object.fromEntries(Object.entries(maps).map(([d,map])=>[d,new Set(map.notes.map(n=>n.beat)).size]));
      for(const [d,minimum]of Object.entries(fixture.minimumLayeredClicks??{})) assert.ok(counts[d]>=minimum,`${d}: ${counts[d]} < ${minimum}`);
      assert.ok(counts.Expert>counts.Hard);
      assert.ok(counts.ExpertPlus>=counts.Expert*1.35);
      assert.ok(counts.Hard>=counts.Normal*2);
      const sourceTimes=[...result.percussionEvents,...result.melodicEvents].map(e=>e.time).sort((a,b)=>a-b);
      for(const map of Object.values(maps)) {
        assert.equal(map.validation.valid,true);
        for(const n of map.notes)assert.ok(nearestDistance(sourceTimes,n.sourceTime)<.00001);
      }
    });

    await t.test("stored learned inference retains the independent pulse fallback backbone", {
      skip: !fixture.referencePath || !fixture.modelResultPath
        ? "Configure referencePath and modelResultPath; no learned inference runs in CI."
        : false,
    }, async () => {
    // Stored output from the actual local inference entry point is input;
    // an earlier independent model run supplies expected pulse timestamps.
    // Neither audio nor model inference/checkpoints are bundled into CI.
    // These checks cover the pulse fallback only. Drum-groove quality requires
    // an independent percussion reference, not quarter-beat coverage.
    const reference = JSON.parse(readFileSync(fixture.referencePath, "utf8"));
    const result = JSON.parse(readFileSync(fixture.modelResultPath, "utf8"));
    const learned = applyBeatModel(analysis, result);
    // Exercise the explicit fallback rather than the primary drum/melody path.
    delete learned.percussionEvents;
    delete learned.melodicEvents;
    assert.equal(learned.beatSource, "learned");
    const maps = generateMaps(learned, { walls: false, bombs: false });
    const [start, end] = reference.reliableRangeSeconds;
    const pulse = reference.times.filter((time) => time >= start && time <= end);
    const sixteenths = referenceSubdivisions(reference.times);
    assert.ok(pulse.length >= 30, "Need a substantial independent pulse interval.");
    for (const [difficulty, map] of Object.entries(maps)) {
      assert.equal(map.validation.valid, true, `${difficulty}: ${JSON.stringify(map.validation.errors)}`);
      const times = noteTimes(map, learned).filter((time) => time >= start && time <= end);
      assert.ok(times.length > 20, difficulty);
      const covered = pulse.filter((time) => nearestDistance(times, time) <= 0.035).length / pulse.length;
      const minimumCoverage = difficulty === "Easy" ? 0.48 : 0.98;
      assert.ok(covered >= minimumCoverage,
        `${difficulty}: only ${(covered * 100).toFixed(1)}% of independent pulse beats retained`);
      const errors = times.map((time) => nearestDistance(sixteenths, time));
      assert.ok(percentile(errors, 0.5) <= 0.015,
        `${difficulty}: independent subdivision median ${percentile(errors, 0.5)} s`);
      assert.ok(percentile(errors, 0.9) <= 0.035,
        `${difficulty}: independent subdivision p90 ${percentile(errors, 0.9)} s`);
      if (difficulty === "Easy" || difficulty === "Normal") {
        const onPulse = times.filter((time) => nearestDistance(pulse, time) <= 0.035).length / times.length;
        assert.ok(onPulse >= 0.9,
          `${difficulty}: ${(onPulse * 100).toFixed(1)}% of attacks reinforce the independent pulse`);
      }
      // Uncertain model tails are intentionally unfilled; do not extrapolate.
      assert.ok(Math.max(...noteTimes(map, learned)) <= result.beatTimes.at(-1) + 0.04);
    }
    const changed = generateMaps(learned, { seed: 771, walls: false, bombs: false });
    for (const d of Object.keys(maps))
      assert.deepEqual(
        changed[d].notes.map((n) => n.beat),
        maps[d].notes.map((n) => n.beat),
        "Seed may change movement vocabulary, not invent a different rhythm.",
      );
    });

    await t.test("browser percussion roles agree with an independent learned drum-stem reference", {
      skip: !fixture.percussionReferencePath || !fixture.modelResultPath
        ? "Configure percussionReferencePath and modelResultPath for the private drum comparison."
        : false,
    }, async (drumTest) => {
      const reference = JSON.parse(readFileSync(fixture.percussionReferencePath, "utf8"));
      const modelResult = JSON.parse(readFileSync(fixture.modelResultPath, "utf8"));
      // Pass beat timing only. Feeding the reference drum events back into the
      // planner here would turn an independent comparison into a tautology.
      const beatOnlyResult = {
        duration: modelResult.duration, bpm: modelResult.bpm, offset: modelResult.offset,
        beatTimes: modelResult.beatTimes, downbeatTimes: modelResult.downbeatTimes,
        model: modelResult.model, quality: modelResult.quality,
        confidence: modelResult.confidence, warnings: modelResult.warnings,
      };
      const learnedHPSS = applyBeatModel(analysis, beatOnlyResult);
      assert.equal(learnedHPSS.percussionMethod, analysis.percussionMethod);
      assert.deepEqual(learnedHPSS.percussionEvents, analysis.percussionEvents,
        "The candidate percussion must come from browser HPSS, not the comparison stem.");
      const maps = generateMaps(learnedHPSS, { walls: false, bombs: false });
      const [start, end] = fixture.percussionReferenceRangeSeconds ?? [22, 188];
      const events = reference.events.filter((event) => event.time >= start && event.time <= end);
      const referenceTimes = events.map((event) => event.time).sort((a, b) => a - b);
      assert.ok(referenceTimes.length >= 30);
      // Define strong independently from the candidate maps: the upper half
      // of isolated-stem attack strengths, rather than a cutoff tuned to pass.
      const strengthMedian = percentile(events.map((event) => event.strength), 0.5);
      const strong = events.filter((event) => event.strength >= strengthMedian);
      for (const [difficulty, map] of Object.entries(maps)) {
        assert.equal(map.rhythmDiagnostics.mode, "percussion-groove");
        assert.equal(map.validation.valid, true, `${difficulty}: ${JSON.stringify(map.validation.errors)}`);
        const percussion = { notes: map.notes.filter((note) =>
          ["kick", "snare", "high"].includes(note.musicalRole),
        ) };
        const times = noteTimes(percussion, learnedHPSS).filter((time) => time >= start && time <= end);
        assert.ok(times.length >= 20, `${difficulty}: too few percussion-role notes for a useful comparison`);
        const errors = times.map((time) => nearestDistance(referenceTimes, time));
        const agreement = errors.filter((error) => error <= 0.05).length / errors.length;
        assert.ok(agreement >= 0.9,
          `${difficulty}: only ${(agreement * 100).toFixed(1)}% of drum-role attacks agree with independent stem hits within 50 ms`);
        const coverage = strong.filter((event) => nearestDistance(times, event.time) <= 0.05).length / strong.length;
        drumTest.diagnostic(`${difficulty}: ${times.length} drum attacks; ${(agreement * 100).toFixed(1)}% agreement within 50 ms; ${(coverage * 100).toFixed(1)}% upper-half-strength stem coverage; p90 ${(percentile(errors, 0.9) * 1000).toFixed(1)} ms. Model-derived reference, not annotated truth.`);
      }
    });
  },
);
