# Verification record

2026-10-15, initial release. These are measured implementation checks, not a claim of ranked-map quality or headset certification.

## Automated

`npm test`: **50 tests passed**, zero failures. This includes real synthesized PCM passed through the audio analyzer, trimming at nonzero times, five-difficulty generation, advanced native lighting, real WASM Vorbis encoding, map validation and ZIP round-trip. The choreography matrix spans 560 tempo/seed/style/difficulty combinations. Export tests include unusual BPM, positive/negative offsets, index filters, native rotation axes, brightness-wave tails, corrupt audio and malformed JSON.

`npm run build`: production static build passes. The main Three.js application bundle is about 164 KB gzipped. The worker's encoder is a separate, locally served asset. Vite warns about chunks above 500 KB before compression; no remote inference or codec CDN is used.

## Browser and media checks

- Studio loads and auto-generates its original sixty-second demo.
- Five difficulty tabs update note/hazard statistics and static pattern safeguards. Current demo at default seed/density gives 42, 80, 123, 156 and 166 notes from Easy through Expert+; 0, 3, 3, 3 and 3 bombs.
- Playback/pause, waveform section seeking, difficulty switching, choreography selection, trim editing and regeneration checked interactively.
- A 9.3–46.7-second trim produces a 37.4-second working segment. Edits disable stale preview/export until regeneration.
- Actual Ogg file import and decoded FLAC import exercised through the browser file chooser.
- Mouse practice starts after a seek without retroactively scoring all earlier notes. A source audit also found/fixed practice replay reset and zero-motion preview inconsistency. Actual human mouse scoring accuracy and VR comfort are not established.
- Browser worker generated a downloadable ZIP containing Info.dat, five difficulty files, PNG cover and song.ogg. Unpacked with Python; FFprobe confirmed Vorbis, 44,100 Hz stereo, 60.000000 seconds. Native Weave color and rotation arrays are present in each difficulty. Later revisions add dynamics/denser Expert+ choreography while retaining the same export pipeline.
- Wide and narrow layouts inspected. The desktop viewport override on the in-app browser was inconsistent with its screenshot surface; screenshots from the restored actual responsive viewport are retained rather than claiming automated pixel-perfect desktop acceptance.

## Live YouTube companion check

The existing user-global yt-dlp launcher referenced a removed Python interpreter. The isolated project-local setup installed yt-dlp 2026.8.19 and dependencies without modifying that launcher. The initially requested Vorbis conversion exposed a system FFmpeg build without libvorbis; the bridge now emits lossless FLAC and the browser performs the final Vorbis encoding.

A live HTTP bridge import of Blender's [Sintel trailer](https://www.youtube.com/watch?v=HOfdboHvshg) returned HTTP 200 and 8,791,150 bytes. FFprobe confirmed stereo FLAC, 48,000 Hz, 52.224 seconds. This copyrighted test asset is not bundled or published with the project. The generic yt-dlp test video was unavailable; no cookies or account access were used. Live access remains dependent on YouTube and downloader behavior.

## Remaining external acceptance

- Actual import/playback on both PC and Quest, with explicit game/loader versions.
- In-headset movement, reach, readability, bomb/wall comfort and lighting frame-rate review.
- Exact Weave fixture appearance, environment/color scheme overrides and show aesthetics in game.
- Broad browser/codec/device matrix, screen-reader and keyboard acceptance, touch-device practice support.
- Representative real music evaluation, variable-tempo alignment and expert mapper feedback. Current BPM/phrase/drop labels are heuristics.
- Hosted-page-to-loopback YouTube import can depend on browser mixed-content/local-network policy. The localhost studio is the reliable intended bridge configuration.
