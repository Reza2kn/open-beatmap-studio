# Hosted YouTube import

The user flow is one URL and one Import track button. No loopback service, copied credential, account cookies or native executable is involved. Uploaded audio continues to stay in the browser. A YouTube URL is sent to the studio's same-origin Worker, which retrieves the public stream and relays it to the browser; mapping/inference/export remain local.

`server/youtube-import.js` uses pinned MIT `youtubei.js@18.1.0` through `youtubei.js/cf-worker`. It creates an anonymous session with `retrieve_player:false` and `enable_session_cache:false`, requests basic video info using the VISIONOS client, and chooses audio-only WebM/Opus (other available audio containers can be selected if WebM is absent). This verified path needs no JavaScript evaluator, account cookie or proof token. This is an empirical client result, not a promise that YouTube will preserve the interface.

`POST /api/youtube/import` accepts a JSON video URL. The API validates the host and video ID, same-origin browser requests, finite 5–600-second duration, media hostname/container and 100 MB declared/streamed byte bounds. Live/upcoming/unavailable/account-restricted streams cannot be imported. The first media chunk is read before HTTP success so a lazy upstream refusal becomes a structured error. The remaining stream respects backpressure and cancellation without buffering the whole song on the Worker. Signed media URLs stay server-side. Responses use private/no-store caching; the importer does not persist audio.

The frontend reads the audio response with download progress, decodes it through Web Audio, then uses the normal analysis/map/lighting/export pipeline. Import cancellation and extraction errors are visible in the source panel. There is no silent external proxy fallback.

The existing vanilla Vite client now builds into `dist/client`; the API Worker builds into `dist/server/index.js`. The Cloudflare Vite plugin supplies the ASSETS binding and `/api/*` worker-first routing, and the vendored Sites plugin preserves the hosting metadata. The original Site project and audience remain unchanged. The previous local bridge is retained only as a legacy development tool.

## Verification

The official “512” video (`206atvk4uyE`) was downloaded completely using the actual importer and through the browser UI in the local Workers runtime: 3,722,658 bytes of Opus stereo, 195.821 seconds. Its bytes matched a separately obtained yt-dlp download. The browser decoded it at 48 kHz, generated all five maps plus native lighting, and exported a ZIP with bombs (Hard: 8). This verifies the implemented local endpoint/UI path; deployment and hosting-IP acceptance require the live check recorded in the verification report.

Tests cover URL/host validation, cross-site rejection before upstream work, size/duration limits, metadata/audio streaming and refusal-before-success behavior. No source recording is published with the site.

Primary references: [YouTube.js](https://github.com/LuanRT/YouTube.js), [browser proxy limitations](https://ytjs.dev/guide/browser-usage), [Cloudflare Vite SPA/API tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/), [Worker streaming limits](https://developers.cloudflare.com/workers/platform/limits/).
