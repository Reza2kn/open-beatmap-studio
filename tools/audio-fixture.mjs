import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
export function fixtureConfig() {
  const local = existsSync(".local-tests/audio-fixture.json")
    ? JSON.parse(readFileSync(".local-tests/audio-fixture.json", "utf8"))
    : {};
  if (
    process.env.BEATMAP_TEST_AUDIO &&
    process.env.BEATMAP_TEST_AUDIO !== local.audioPath
  )
    return { audioPath: process.env.BEATMAP_TEST_AUDIO };
  return local;
}
export function decodeAudioFile(
  path,
  { sampleRate = 11025, channels = 1 } = {},
) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      path,
      "-ar",
      String(sampleRate),
      "-ac",
      String(channels),
      "-f",
      "f32le",
      "pipe:1",
    ],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr.toString());
  const floats = new Float32Array(
    result.stdout.buffer.slice(
      result.stdout.byteOffset,
      result.stdout.byteOffset + result.stdout.byteLength,
    ),
  );
  const length = floats.length / channels,
    data = Array.from({ length: channels }, (_, c) =>
      Float32Array.from({ length }, (_, i) => floats[i * channels + c]),
    );
  return {
    duration: length / sampleRate,
    length,
    sampleRate,
    numberOfChannels: channels,
    getChannelData: (c) => data[c],
  };
}
export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export function percentile(values, q) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered.length
    ? ordered[Math.min(ordered.length - 1, Math.floor(q * ordered.length))]
    : null;
}
export function nearestDistance(times, t) {
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(
    Math.abs((times[lo] ?? Infinity) - t),
    Math.abs((times[lo - 1] ?? -Infinity) - t),
  );
}
