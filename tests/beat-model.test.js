import test from "node:test";
import assert from "node:assert/strict";
import { applyBeatModel } from "../src/beat-model.js";
import { createBridge } from "../server/bridge.mjs";

test("learned result preserves irregular beat times and rejects mismatched audio", () => {
  const a = { duration: 12, bpm: 120, offset: 0, onsets: [] };
  const result = { duration: 12, bpm: 120, offset: .1, beatTimes: [.1, .61, 1.12, 1.60], downbeatTimes: [.1], model: { id: "test" } };
  const out = applyBeatModel(a, result);
  assert.deepEqual(out.modelBeatTimes, result.beatTimes);
  assert.equal(out.beatSource, "learned");
  assert.throws(() => applyBeatModel(a, { ...result, duration: 10 }));
  assert.throws(() => applyBeatModel(a, { ...result, beatTimes: [.1, .8, .7, 1] }));
});

test("authenticated companion passes only bounded PCM to beat inference", async () => {
  let calls = 0;
  const { server } = createBridge({ token: "test", analyze: async audio => {
    calls++; assert.equal(audio.byteLength, 22050 * 5 * 4);
    return { beatTimes: [0, .5, 1, 1.5] };
  } });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/analyze`;
  try {
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    const headers = { Authorization: "Bearer test", "Content-Type": "application/octet-stream" };
    assert.equal((await fetch(url, { method: "POST", headers, body: new Uint8Array(3) })).status, 400);
    const response = await fetch(url, { method: "POST", headers, body: new Uint8Array(22050 * 5 * 4) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).beatTimes, [0, .5, 1, 1.5]);
    assert.equal(calls, 1);
  } finally { await new Promise(r => server.close(r)); }
});
