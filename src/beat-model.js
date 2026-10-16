/** Learned inference stays on the user's computer through the authenticated loopback companion. */
export const LOCAL_STUDIO_URL = 'http://127.0.0.1:4174/connect';
export function isLocalNeuralStudio(location = globalThis.location) {
  return /^http:\/\/(127\.0\.0\.1|localhost):4174$/.test(location?.origin || '')
    && /^\/studio\/?$/.test(location?.pathname || '');
}
export function companionConnection(key = '', location = globalThis.location) {
  const local = isLocalNeuralStudio(location);
  return {url:local ? location.origin : 'http://127.0.0.1:4174',
    headers:key.trim() ? {Authorization:`Bearer ${key.trim()}`} : {},
    credentials:local ? 'same-origin' : 'omit', local};
}
export async function checkLocalCompanion(key = '', {fetcher=globalThis.fetch, location=globalThis.location} = {}) {
  const connection=companionConnection(key,location);
  if(!key.trim()&&!connection.local)
    throw new Error('Open the local neural studio to connect. This hosted tab has no companion connection.');
  let response;
  try {
    response=await fetcher(connection.url+'/health',{headers:connection.headers,credentials:connection.credentials,signal:AbortSignal.timeout(8000)});
  } catch {
    throw new Error('Could not connect to the companion. Open the local neural studio at 127.0.0.1:4174/connect. Keep npm run bridge running.');
  }
  if(!response.ok)throw new Error(connection.local
    ? 'Your local connection expired. Open 127.0.0.1:4174/connect to reconnect.'
    : 'The companion key is invalid. Open the local neural studio to connect without copying a key.');
  const status=await response.json();
  if(!status.ready)throw new Error('The local companion is not ready. Keep npm run bridge running.');
  return connection;
}

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
  const connection=await checkLocalCompanion(key);
  const rate = 22050;
  const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * rate), rate);
  const source = offline.createBufferSource();
  source.buffer = buffer; source.connect(offline.destination); source.start();
  const mono = await offline.startRendering();
  const response = await fetch(connection.url+'/analyze', {
    method: "POST", headers: { ...connection.headers, "Content-Type": "application/octet-stream" },
    credentials:connection.credentials,
    body: mono.getChannelData(0).slice().buffer,
    signal: AbortSignal.timeout(900000),
  }).catch(e => { throw new Error(e.name === "TimeoutError" ? "Local beat inference timed out." : "Could not reach the local beat tracker. Run npm run model:setup, then npm run bridge, and allow local network access."); });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Local beat inference failed.");
  return result;
}
