import test from "node:test";
import assert from "node:assert/strict";
import { audibleContextTime, Transport } from "../src/media.js";
test("preview follows speaker-output time rather than the ahead-of-sound render clock", () => {
  const context = {
    currentTime: 10,
    baseLatency: 0.02,
    outputLatency: 0.03,
    getOutputTimestamp: () => ({ contextTime: 9.94, performanceTime: 1000 }),
  };
  assert.ok(Math.abs(audibleContextTime(context, 1010) - 9.95) < 1e-9);
  assert.equal(
    audibleContextTime(context, 1200),
    10,
    "Never run ahead of the rendering clock",
  );
  delete context.getOutputTimestamp;
  assert.ok(Math.abs(audibleContextTime(context) - 9.95) < 1e-9);
});
test("play starts at the requested position and latency does not move it backwards", async () => {
  const source = {
    connect() {},
    start() {},
    stop() {},
    disconnect() {},
    playbackRate: {},
  };
  const context = {
    currentTime: 0,
    outputLatency: 0.04,
    baseLatency: 0.01,
    destination: {},
    resume: async () => {},
    createGain: () => ({ connect() {}, gain: {} }),
    createBufferSource: () => source,
  };
  const t = new Transport(context);
  t.load({ duration: 60 });
  t.seek(30);
  await t.play();
  assert.equal(t.time, 30);
  context.currentTime = 0.1;
  assert.ok(Math.abs(t.time - 30.05) < 1e-9);
  t.pause();
  assert.ok(Math.abs(t.position - 30.05) < 1e-9);
});
