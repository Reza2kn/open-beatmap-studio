import test from "node:test";
import assert from "node:assert/strict";
import { createDemo, trimAudio } from "../src/media.js";
import { analyzeAudio } from "../src/audio.js";
import { generateMaps } from "../src/generator.js";
import { generateLightshow } from "../src/lighting.js";
import { buildMapFiles, validateMapFiles } from "../src/export.js";
import { createOggEncoder } from "wasm-media-encoders";
const context = {
  createBuffer(channels, length, sampleRate) {
    const data = Array.from(
      { length: channels },
      () => new Float32Array(length),
    );
    return {
      sampleRate,
      length,
      numberOfChannels: channels,
      duration: length / sampleRate,
      getChannelData: (c) => data[c],
      copyToChannel: (src, c) => data[c].set(src),
    };
  },
};
test("real PCM demo → trim → spectral analysis → five maps → native lightshow → real Ogg export", async () => {
  const original = createDemo(context);
  assert.equal(original.duration, 60);
  assert.throws(() => trimAudio(original, 5, 7, context));
  const audio = trimAudio(original, 9.3, 46.7, context);
  const analysis = await analyzeAudio(audio, {
    bpmOverride: 128,
    offsetOverride: -0.13,
  });
  assert.ok(analysis.onsets.length > 50);
  assert.ok(analysis.sections.length > 2);
  const maps = generateMaps(analysis),
    show = generateLightshow(analysis);
  assert.ok(show.stats.colorGroups > 100);
  assert.ok(show.stats.rotationGroups > 0);
  const encoder = await createOggEncoder();
  encoder.configure({
    channels: 2,
    sampleRate: audio.sampleRate,
    vbrQuality: 3,
  });
  const chunks = [];
  for (let i = 0; i < audio.length; i += 16384)
    chunks.push(
      encoder
        .encode([
          audio.getChannelData(0).subarray(i, i + 16384),
          audio.getChannelData(1).subarray(i, i + 16384),
        ])
        .slice(),
    );
  chunks.push(encoder.finalize().slice());
  const bytes = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let n = 0;
  for (const c of chunks) {
    bytes.set(c, n);
    n += c.length;
  }
  const files = buildMapFiles({
    bpm: analysis.bpm,
    offset: analysis.offset,
    duration: audio.duration,
    audioBytes: bytes,
    maps,
    lightshow: show,
  });
  const validation = validateMapFiles(files, { duration: audio.duration });
  assert.deepEqual(validation.errors, []);
  assert.equal(
    JSON.parse(new TextDecoder().decode(files["Info.dat"]))._environmentName,
    "WeaveEnvironment",
  );
  for (const d of Object.keys(maps)) {
    const m = JSON.parse(new TextDecoder().decode(files[d + ".dat"]));
    assert.equal(
      m.lightColorEventBoxGroups.length,
      show.lightColorEventBoxGroups.length,
    );
    assert.equal(
      m.lightRotationEventBoxGroups.length,
      show.lightRotationEventBoxGroups.length,
    );
    assert.ok(m.colorNotes.length > 0);
  }
});
