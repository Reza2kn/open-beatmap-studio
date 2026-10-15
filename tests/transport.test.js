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

test("seeking on an established audio clock holds at the new position until its output starts", async () => {
  const context = {
    currentTime: 100,
    outputLatency: 0.04,
    baseLatency: 0.01,
    destination: {},
    resume: async () => {},
    createGain: () => ({ connect() {}, gain: {} }),
    createBufferSource: () => ({
      connect() {}, start() {}, stop() {}, disconnect() {}, playbackRate: {},
    }),
  };
  const transport = new Transport(context);
  transport.load({ duration: 60 });
  transport.seek(30);
  await transport.play();
  assert.equal(transport.time, 30);
  context.currentTime = 100.025;
  assert.equal(transport.time, 30);
  context.currentTime = 100.1;
  assert.ok(Math.abs(transport.time - 30.05) < 1e-9);
  transport.pause();
});

function deferredContext() {
  let resume;
  const resumed = new Promise((resolve) => { resume = resolve; });
  const sources = [];
  const context = {
    currentTime: 100, outputLatency: 0.1, baseLatency: 0, destination: {},
    resume: () => resumed,
    createGain: () => ({ connect() {}, gain: {} }),
    createBufferSource: () => {
      const source = {
        starts: [], stopped: false, playbackRate: {},
        connect() {}, disconnect() {},
        start(...args) { this.starts.push(args); },
        stop() { this.stopped = true; },
      };
      sources.push(source);
      return source;
    },
  };
  return { context, sources, resume };
}

test("concurrent play requests share one pending resume and pause stops every started source", async () => {
  const fixture = deferredContext();
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60 });
  const first = transport.play(), second = transport.play();
  assert.equal(first, second, "Coalesce while the audio device is resuming.");
  fixture.resume();
  await Promise.all([first, second]);
  assert.equal(fixture.sources.length, 1, "Double playback must never start.");
  await transport.play();
  assert.equal(fixture.sources.length, 1, "Playing is idempotent after resume too.");
  transport.pause();
  assert.ok(fixture.sources.every((source) => source.stopped));
});

test("pause cancels an unfinished play request before it can create a source", async () => {
  const fixture = deferredContext();
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60 });
  const play = transport.play();
  transport.pause();
  fixture.resume();
  await play;
  assert.equal(fixture.sources.length, 0);
  assert.equal(transport.playing, false);
});

test("pending seek and speed changes preserve the last playback intent without duplicate sources", async () => {
  const fixture = deferredContext();
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60 });
  const initial = transport.play();
  transport.seek(12);
  transport.seek(30);
  transport.setRate(0.5);
  const final = transport.play();
  fixture.resume();
  await Promise.all([initial, final]);
  assert.equal(fixture.sources.length, 1);
  assert.deepEqual(fixture.sources[0].starts, [[0, 30]]);
  assert.equal(fixture.sources[0].playbackRate.value, 0.5);
  assert.equal(transport.time, 30);
  transport.pause();
});

test("loading another song invalidates a pending play of the previous buffer", async () => {
  const fixture = deferredContext();
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60, title: "first" });
  const play = transport.play();
  const replacement = { duration: 20, title: "replacement" };
  transport.load(replacement);
  fixture.resume();
  await play;
  assert.equal(fixture.sources.length, 0);
  await transport.play();
  assert.equal(fixture.sources.length, 1);
  assert.equal(fixture.sources[0].buffer, replacement);
  transport.pause();
});

test("an ended callback from a superseded source cannot finish the new playback", async () => {
  const fixture = deferredContext();
  fixture.resume();
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60 });
  await transport.play();
  const staleEnded = fixture.sources[0].onended;
  transport.seek(30);
  await transport.play();
  staleEnded();
  assert.equal(transport.playing, true);
  assert.equal(transport.time, 30);
  assert.equal(transport.source, fixture.sources[1]);
  transport.pause();
});

test("render completion keeps the clock alive until the device has played its buffered tail", async (t) => {
  const scheduled = [];
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const handle = { callback, delay };
    scheduled.push(handle);
    return handle;
  });
  const fixture = deferredContext();
  fixture.resume();
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60 });
  await transport.play();
  fixture.context.currentTime = 160;
  assert.ok(Math.abs(transport.time - 59.9) < 1e-8);
  fixture.sources[0].onended();
  assert.equal(transport.playing, true, "The graph ended but 100 ms of sound remains.");
  assert.ok(Math.abs(transport.time - 59.9) < 1e-8, "Do not jump visuals ahead of the remaining sound.");
  assert.equal(scheduled.length, 1);
  assert.ok(scheduled[0].delay > 0 && scheduled[0].delay <= 25);
  fixture.context.currentTime = 160.1;
  scheduled[0].callback();
  assert.equal(transport.playing, false);
  assert.equal(transport.time, 60);
});

test("pausing during the buffered tail cancels completion without changing the paused position", async (t) => {
  let callback;
  t.mock.method(globalThis, "setTimeout", (fn) => { callback = fn; return {}; });
  const fixture = deferredContext();
  fixture.resume();
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60 });
  await transport.play();
  fixture.context.currentTime = 160;
  fixture.sources[0].onended();
  transport.pause();
  fixture.context.currentTime = 160.2;
  callback();
  assert.equal(transport.playing, false);
  assert.ok(Math.abs(transport.time - 59.9) < 1e-8);
});

test("note clicks use the source sample clock at slowed playback and share its output latency", async (t) => {
  let tick;
  t.mock.method(globalThis, "setInterval", (callback) => { tick = callback; return {}; });
  const fixture = deferredContext();
  fixture.resume();
  const oscillators = [];
  fixture.context.createGain = () => ({ connect() {}, disconnect() {}, gain: {
    setValueAtTime() {}, exponentialRampToValueAtTime() {},
  } });
  fixture.context.createOscillator = () => {
    const oscillator = { frequency: {}, connect() {}, disconnect() {},
      start(time) { this.started = time; }, stop() {} };
    oscillators.push(oscillator);
    return oscillator;
  };
  const transport = new Transport(fixture.context);
  transport.load({ duration: 60 });
  transport.seek(4);
  transport.setRate(0.5);
  transport.setClickTimes([5], "notes");
  await transport.play();
  assert.equal(oscillators.length, 0);
  fixture.context.currentTime = 101.8;
  tick();
  assert.equal(oscillators.length, 1);
  assert.equal(oscillators[0].started, 102, "Sample time 5 occurs two context seconds after starting at 4 at half speed.");
  fixture.context.currentTime = 102.1;
  assert.ok(Math.abs(transport.time - 5) < 1e-8, "Visual time matches that click after the same 100 ms device buffer.");
  transport.pause();
});
