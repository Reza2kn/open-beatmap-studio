import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeAudio,
  pickOnsets,
  estimateTempo,
  detectSections,
} from "../src/audio.js";

function clicks({
  bpm = 120,
  offset = 0.2,
  duration = 20,
  sampleRate = 11025,
  silent = false,
} = {}) {
  const data = new Float32Array(Math.floor(duration * sampleRate));
  if (!silent)
    for (let time = offset; time < duration; time += 60 / bpm) {
      const start = Math.round(time * sampleRate);
      for (let j = 0; j < 700 && start + j < data.length; j++)
        data[start + j] +=
          Math.sin((2 * Math.PI * 170 * j) / sampleRate) * Math.exp(-j / 85);
    }
  return {
    length: data.length,
    duration,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

test("autocorrelation recovers a known tempo and phase without preselected BPM", () => {
  const step = 0.01,
    envelope = new Float32Array(3000);
  for (let time = 0.23; time < 30; time += 0.5)
    envelope[Math.round(time / step)] = 1;
  const onsets = pickOnsets(envelope, step);
  const result = estimateTempo(envelope, step, onsets);
  assert.ok(Math.abs(result.bpm - 120) < 0.15, JSON.stringify(result));
  assert.ok(Math.abs(result.offset - 0.23) < 0.02);
  assert.ok(result.confidence > 0 && result.confidence <= 1);
  assert.ok(
    result.tempoCandidates.some((c) => Math.abs(c.bpm - 60) < 0.2),
    "Half-time alternative is reported",
  );
});

test("real FFT pipeline detects click timing, returns finite bounded features and contiguous sections", async () => {
  const result = await analyzeAudio(clicks());
  assert.ok(Math.abs(result.bpm - 120) < 0.3, `Detected ${result.bpm}`);
  assert.ok(Math.abs(result.offset - 0.2) < 0.045, `Offset ${result.offset}`);
  assert.ok(
    result.onsets.length >= 35 && result.onsets.length <= 42,
    `Onsets ${result.onsets.length}`,
  );
  for (const onset of result.onsets) {
    assert.ok(
      Number.isFinite(onset.time) &&
        onset.time >= 0 &&
        onset.time <= result.duration,
    );
    assert.ok(onset.strength >= 0 && onset.strength <= 1);
    assert.ok(Math.abs(onset.low + onset.mid + onset.high - 1) < 1e-6);
  }
  assert.equal(result.waveform.length, 800);
  assert.ok(
    result.energy.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ),
  );
  assert.equal(result.sections[0].start, 0);
  assert.equal(result.sections.at(-1).end, result.duration);
  for (let i = 1; i < result.sections.length; i++)
    assert.equal(result.sections[i - 1].end, result.sections[i].start);
});

test("manual timing overrides survive analysis exactly and negative offset grid stays in audio", async () => {
  const result = await analyzeAudio(clicks({ duration: 3 }), {
    bpmOverride: 137.5,
    offsetOverride: -0.12,
  });
  assert.equal(result.bpm, 137.5);
  assert.equal(result.offset, -0.12);
  assert.ok(result.beatTimes[0] >= 0);
  assert.ok(
    Math.abs(result.beatTimes[1] - result.beatTimes[0] - 60 / 137.5) < 1e-8,
  );
});

test("silence does not invent confident onsets or beats", async () => {
  const result = await analyzeAudio(clicks({ silent: true, duration: 1 }));
  assert.equal(result.confidence, 0);
  assert.equal(result.silent, true);
  assert.deepEqual(result.onsets, []);
  assert.deepEqual(result.beatTimes, []);
  assert.ok(result.energy.every((x) => x === 0));
});

test("section labels distinguish a sustained quiet passage from high energy", () => {
  const result = detectSections(
    [...Array(80).fill(0.05), ...Array(80).fill(0.9)],
    0.1,
    120,
    16,
  );
  assert.equal(result[0].label, "quiet");
  assert.equal(result[1].label, "peak");
});

test("reject invalid buffers and overrides with actionable errors", async () => {
  await assert.rejects(analyzeAudio(null), /non-empty/);
  await assert.rejects(
    analyzeAudio(clicks({ duration: 0.1 }), { bpmOverride: -4 }),
    /BPM/,
  );
  await assert.rejects(
    analyzeAudio(clicks({ duration: 0.1 }), { offsetOverride: Infinity }),
    /offset/,
  );
});
