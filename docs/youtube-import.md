# Hosted YouTube import

End users select YouTube link, paste one video URL and click Import track. They never install a downloader, run a companion, or copy a key. Uploaded audio stays in the browser. For a YouTube URL, the studio Worker obtains audio and returns it to the same decode/analysis/map/lighting/preview/export pipeline. Neural inference and final Ogg/ZIP encoding run on the user's device.

## Download paths

`server/youtube-import.js` validates HTTPS YouTube hosts/video IDs, same-origin browser requests, JSON size, finite 5–600-second duration and 100 MB declared/streamed audio limits. Live/upcoming and unavailable media are rejected. Audio responses use private/no-store caching. A first media chunk is checked before success headers, and the relay respects backpressure. Signed YouTube URLs and infrastructure credentials stay server-side.

Without an operator origin, pinned MIT `youtubei.js@18.1.0` uses an anonymous, server-derived VISIONOS session, with a bounded ANDROID_VR metadata fallback and accurate player-refusal errors. Session bootstrap fails explicitly instead of silently synthesizing a session. This path downloads the complete reference video locally, but YouTube refuses this Site's Cloudflare hosting network with LOGIN_REQUIRED / bot confirmation. It is not a verified working production download path on this host.

For hosting networks YouTube refuses, set runtime secrets `YOUTUBE_ORIGIN_URL` and `YOUTUBE_ORIGIN_SECRET`. The Worker sends only the validated video ID and its server-only credential to the operator-owned HTTPS origin. It validates audio type, exact length and duration before relaying. Cookies, browser identity headers and signed playback URLs are not forwarded to the origin or exposed in the app. The frontend has no origin URL or credential field.

`server/youtube-relay.py` runs on a separate operator-owned server with Python and pinned `yt-dlp==2026.8.19`. It binds only to loopback, requires a strong bearer credential, accepts IDs rather than arbitrary URLs/paths/options, ignores user-global downloader configuration, and selects direct HTTPS audio with VISIONOS. It limits two concurrent downloads and 24 admitted requests per ten minutes. Missing fragments abort; there is no partial-song success fallback. Jobs have a 90-second timeout; request-scoped temporary media/metadata are deleted after delivery or failure. Cancelling the browser stops delivery; an already-running origin job may finish before its timeout.

The supplied user service caps memory at 384 MiB, CPU at one core and each output file at 100 MiB. It uses no GPU, has no write access to the home/project tree, and puts temporary files in a private temporary directory. The HTTPS ingress must expose only this authenticated service. A local environment file containing the origin credential must be operator-owned and mode 0600; configure the matching Site value through runtime secrets, never source control or frontend code. The service and secret are hosting infrastructure, not an end-user companion.

The Vite client builds into `dist/client`, and the API Worker into `dist/server/index.js`. The Cloudflare plugin provides ASSETS and worker-first `/api/*`; the Sites plugin preserves hosting metadata. The build clears obsolete generated output before emitting both environments. Existing Site identity and audience remain unchanged.

## Verification and current activation boundary

The official “512” video (`206atvk4uyE`) downloads completely through the local Worker and on the operator origin: 3,722,658 bytes of WebM/Opus stereo, 195.821 seconds, SHA-256 `12e85975f8a325346d3066b42e30d45396fa5c474de7184335fd0406bbf306d3`. Two consecutive origin API checks returned byte-identical audio. Unauthorized origin health requests return 401; malformed video IDs return 400 before extraction. The local browser importer decoded the full YouTube audio, generated all five maps and native lights, and exported a valid ZIP.

The Site's actual Cloudflare requests for both “512” and Sintel were refused as bots, including an experimental real-browser video-bound PO proof. That experiment is removed from the product. The protected origin is prepared on Stallion, but Tailscale reports Funnel is disabled on the tailnet. Enabling HTTPS ingress requires the owner's explicit approval. Until activated and verified through the hosted UI, YouTube import on this production host remains incomplete. No end-user key or installation is offered as a workaround.

Node tests cover URL/cross-site rejection, lazy refusal, bounded audio metadata/streaming, server-only forwarding and origin failure handling. Python tests cover ID/path injection, output bounds, authentication before work and busy retries preserving the rate quota. No source recording is published with the Site.

Primary references: [YouTube.js](https://github.com/LuanRT/YouTube.js), [browser proxy limitations](https://ytjs.dev/guide/browser-usage), [yt-dlp](https://github.com/yt-dlp/yt-dlp), [Cloudflare Vite SPA/API tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/).
