/** Learned inference stays on the user's computer through the authenticated loopback companion. */
export function applyBeatModel(analysis, result) {
  const times = result?.beatTimes;
  if (!Array.isArray(times) || times.length < 4 || !times.every((t, i) =>
    Number.isFinite(t) && t >= 0 && t < analysis.duration + 0.05 && (!i || t > times[i - 1])))
    throw new Error("The beat model returned an invalid pulse sequence.");
  if (Math.abs(result.duration - analysis.duration) > 0.1 || !(result.bpm >= 40 && result.bpm <= 300) || !Number.isFinite(result.offset))
    throw new Error("The model result does not match this trimmed audio.");
  return { ...analysis, bpm: result.bpm, offset: result.offset, confidence: result.confidence ?? analysis.confidence,
    beatTimes: times.slice(), modelBeatTimes: times.slice(),
    downbeatTimes: (result.downbeatTimes || []).filter(t => Number.isFinite(t) && t >= 0 && t < analysis.duration),
    beatSource: "learned", beatModel: result.model, modelQuality: result.quality,
    modelWarnings: [...(result.warnings || []), ...(result.melodicSource === 'demucs-htdemucs-other' && !result.melodicMethod
      ? ['Update the local companion for improved instrument attack detection.'] : [])],
    ...(Array.isArray(result.melodicEvents) ? {
      melodicEvents:result.melodicEvents.filter(e=>Number.isFinite(e.time)&&e.time>=0&&e.time<analysis.duration
        && !(e.source==='demucs-htdemucs-other' && e.detail)),
      melodicSource:result.melodicSource,
      melodicMethod:result.melodicMethod,
    } : {}),
    ...(Array.isArray(result.percussionEvents) ? {
      percussionEvents: result.percussionEvents.filter(e=>Number.isFinite(e.time)&&e.time>=0&&e.time<analysis.duration),
      percussionSource: result.percussionSource || "learned-drums",
      percussionMethod: result.percussionMethod,
      drumQuality: result.drumQuality,
    } : {}) };
}

export async function trackBeatsLocally(buffer, key) {
  if (!key.trim()) throw new Error("Paste the local companion key to use the learned beat tracker. Open Beat tracker setup for instructions.");
  const rate = 22050;
  const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * rate), rate);
  const source = offline.createBufferSource();
  source.buffer = buffer; source.connect(offline.destination); source.start();
  const mono = await offline.startRendering();
  const response = await fetch("http://127.0.0.1:4174/analyze", {
    method: "POST", headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/octet-stream" },
    body: mono.getChannelData(0).slice().buffer,
    signal: AbortSignal.timeout(900000),
  }).catch(e => { throw new Error(e.name === "TimeoutError" ? "Local beat inference timed out." : "Could not reach the local beat tracker. Run npm run model:setup, then npm run bridge, and allow local network access."); });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Local beat inference failed.");
  return result;
}
