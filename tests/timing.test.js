import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAudio, estimateTempo } from "../src/audio.js";
function dembow({ sampleRate = 11025, gain = 1, duration = 48 } = {}) {
  const bpm = 88,
    offset = 0.25,
    period = 60 / bpm,
    data = new Float32Array(Math.ceil(sampleRate * duration));
  const hit = (t, f, amp, len = 0.09) => {
    const start = Math.round(t * sampleRate);
    for (let j = 0; j < len * sampleRate && start + j < data.length; j++)
      data[start + j] +=
        gain *
        amp *
        Math.sin((2 * Math.PI * f * j) / sampleRate) *
        Math.exp(-j / (sampleRate * 0.012));
  };
  for (let b = 0; offset + b * period < duration; b += 0.25) {
    if (Number.isInteger(b)) hit(offset + b * period, 90, 0.8);
    if ([0.75, 1.5, 2.75, 3.5].some((x) => Math.abs((b % 4) - x) < 1e-6))
      hit(offset + b * period, 1450, 0.48);
    hit(offset + b * period, 3600, 0.08, 0.035);
  }
  return {
    duration,
    length: data.length,
    sampleRate,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}
test("syncopated kick/snare groove retains full beat phase and stable human-pulse octave", async () => {
  const a = await analyzeAudio(dembow());
  assert.ok(Math.abs(a.bpm - 88) < 0.05, `bpm ${a.bpm}`);
  assert.ok(Math.abs(a.offset - 0.25) < 0.02, `phase ${a.offset}`);
  const quiet = await analyzeAudio(dembow({ gain: 0.06 }));
  assert.ok(Math.abs(quiet.bpm - a.bpm) < 0.003);
  assert.ok(Math.abs(quiet.offset - a.offset) < 0.002);
  assert.ok(
    a.rhythmEvents.every(
      (e) => e.source === "acoustic" && Math.abs(e.time - e.spectralTime) < 0.1,
    ),
  );
});
test("fine BPM precision avoids long-track rounding drift even for an ambiguous click octave", () => {
  const bpm = 123.456,
    period = 60 / bpm,
    step = 0.004,
    duration = 180,
    envelope = new Float32Array(duration / step);
  const events = [];
  for (let t = 0.231; t < duration; t += period) {
    envelope[Math.round(t / step)] = 1;
    events.push({ time: t, strength: 1, low: 1 });
  }
  const result = estimateTempo(envelope, step, events);
  assert.ok(
    Math.min(Math.abs(result.bpm - bpm), Math.abs(result.bpm * 2 - bpm)) <
      0.0025,
    JSON.stringify(result),
  );
});
