import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeAudio } from "../src/audio.js";
import { generateMaps } from "../src/generator.js";
import {
  fixtureConfig,
  decodeAudioFile,
  sha256File,
  percentile,
  nearestDistance,
} from "../tools/audio-fixture.mjs";
const fixture = fixtureConfig();
test(
  "configured private real-song regression: decoding, independent beat reference, observed attacks and movement",
  {
    skip: !fixture.audioPath
      ? "Set BEATMAP_TEST_AUDIO or .local-tests/audio-fixture.json; no copyrighted song is bundled."
      : false,
  },
  async () => {
    if (fixture.sha256)
      assert.equal(
        sha256File(fixture.audioPath),
        fixture.sha256,
        "The regression must use the exact supplied recording.",
      );
    const buffer = decodeAudioFile(fixture.audioPath),
      analysis = await analyzeAudio(buffer);
    assert.ok(analysis.rhythmEvents.length > 20);
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
    const events = analysis.rhythmEvents.map((e) => e.time),
      maps = generateMaps(analysis);
    for (const [name, map] of Object.entries(maps)) {
      assert.equal(
        map.validation.valid,
        true,
        `${name}: ${JSON.stringify(map.validation.errors)}`,
      );
      for (const n of map.notes) {
        const time = analysis.offset + (n.beat * 60) / analysis.bpm;
        assert.ok(
          nearestDistance(events, time) < 0.0001,
          `${name}: a note invented an unsupported timestamp ${time}`,
        );
      }
      assert.ok(map.notes.length > 20);
    }
    const changed = generateMaps(analysis, { seed: 771 });
    for (const d of Object.keys(maps))
      assert.deepEqual(
        changed[d].notes.map((n) => n.beat),
        maps[d].notes.map((n) => n.beat),
        "Seed may change movement vocabulary, not invent a different rhythm.",
      );
  },
);
