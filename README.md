# Open Beatmap Studio

A free, open source, browser-first Beat Saber map generator. Bring your audio, shape the choreography, direct a native rhythm-driven lightshow, try the map with your mouse, and export all five difficulties in one ZIP.

[Public MIT source](https://github.com/Reza2kn/open-beatmap-studio) · [Lighting research](docs/lighting-research.md) · [Verification record](docs/verification.md)

## Run locally

Node.js 22.12+ recommended (Vite requires Node 20.19+ or 22.12+).

```sh
npm install
npm run dev
```

Open the printed localhost URL. An original one-minute synth composition is generated on your device as a working demo. The demo uses fast browser DSP and downloads no recording or model weights. Uploaded tracks use browser neural analysis by default, with a first-use model/runtime download of about 17 MB. Upload MP3, WAV, Ogg Vorbis, FLAC or M4A supported by your browser, up to 100 MB. Trim tracks to between 5 seconds and 10 minutes.

```sh
npm test
npm run build
npm run preview
```

## What works

Track editing and map/light direction use separate control tabs. Generate remains at the top of either tab; details, trimming, lighting and audio-analysis options expand when needed. The preview adapts to screen height while preserving the larger text.

- Browser audio decoding/trimming, harmonic-percussive median separation, refined transient attacks, approximate constant BPM/phase, RMS energy and sixteen-beat phrase windows.
- Editable BPM/grid offset, half/double tempo controls, deterministic seeds, density, four choreography styles, optional walls/bombs/lighting.
- Easy, Normal, Hard, Expert and Expert+ Standard maps that prioritize repeated kick/snare grooves, use rhythmic melodic attacks in drumless passages, repeat movement phrases and simplify the same groove across difficulty profiles, with hand alternation, parity and hazard-clearance safeguards. Difficulty names are generated profiles, not ranked-map certification.
- **Advanced native Weave lighting:** individual fixture color waves, complementary color halves, brightness gradients, index filters, eased X/Y beam rotations, distributed fans, bass/percussion accents, phrase builds and energy-jump blooms, dim rests and final blackout. No Chroma dependency. Brightness and motion controls; a dedicated lightshow view.
- Three.js browser stage with a visible cut frame and automatic cuts on mapped attacks, note-click timing review enabled by default, optional beat-grid clicks, waveform hit annotations, speaker-clock synchronization, seeking, playback speed/volume, mouse practice with directional cuts, score, combo, bombs and wall penalties. Hold the primary mouse button and swipe through either color near the cut frame, following the arrow. Swept collision tests follow the visible moving cube. Space toggles playback outside form fields.
- Worker-based real Vorbis encoding and ZIP export with `Info.dat`, five `.dat` difficulty files, `song.ogg` and square PNG cover art. Optional uploaded cover, title/artist/mapper metadata.

Audio analysis, mapping, preview, encoding and ZIP creation run on your device. No API keys, hosted inference or paid services. Beat-model/runtime assets and the encoder are bundled and self-hosted. Optional full drum separation downloads a further 118 MB learned core as checksum-verified same-origin static shards, cached locally when browser storage allows. Loading the app still requires a web server; this version does not install an offline service worker.

## Neural analysis: entirely in your browser

The default **Neural pulse · fast** runs **Beat This! small0** for beats/downbeats and browser DSP for physical drum/instrument attacks. On the supplied 195.86-second recording, the production browser build generated all five maps and native lighting in **9.1 seconds total** with cached assets and WebGPU. This is one measured computer, not a guarantee for other hardware; first-use downloads are additional. It is a hybrid, not learned drum separation.

**Neural drums · full** additionally runs **HTDemucs v4** to isolate drums, other instruments and vocals. Both learned networks execute locally in dedicated ONNX Runtime Web workers, preferring WebGPU with a visible WASM fallback. Full separation took **98 seconds** on the same recording with cached assets. It is optional because it does not meet the ten-second generation target. There is no companion to install, no API key, and no second studio. The original synth demo uses DSP and downloads no model weights.

Fast mode downloads approximately **17 MB** of static model/runtime files on first use; full separation brings the total to approximately **140 MB**. Retained browser caches reuse these files. Cancel stops the active worker and preserves your track for retry or trimming. **Browser pulse · fast** uses only DSP. Neural failures are shown instead of silently switching algorithms.

See [browser neural architecture and provenance](docs/browser-neural.md) and [Beat This! conversion/parity](docs/browser-beat-model.md). The old optional Python helper remains in the repository for experimentation; it is not called by browser neural mode.

The arranger uses the pulse as a timing reference, then selects audible instrument attacks. Separated kick/snare patterns form the main groove; aligned melodic attacks lead in drumless passages. The difficulty scale starts with the former Hard groove as its Easy baseline. Normal through Expert+ progressively admit supported detail and increase movement complexity and speed. Extra notes require acoustic evidence; a song with few distinct sounds can reach a timing-density ceiling before Expert+. Simultaneous two-saber notes still produce one click. Browser HPSS is an approximate transient separator and can confuse vocals or piano with drums; the optional full neural mode uses an actual learned drum stem. Fast neural pulse retains DSP attack detection. Each percussion band refines timing on its own filtered signal so nearby louder sounds do not steal the attack time. The seed changes movement rather than rhythm. The same rhythmic events also direct lightshow accents. The GPU-compatible core keeps inverse STFT in CPU JavaScript; the ONNX port preserves model pulse timestamps and detects physical attacks on separated stems.

## YouTube: optional local bridge

Direct YouTube media downloads do not reliably work inside browser CORS and media-access restrictions. A small opt-in loopback companion uses local `yt-dlp` and FFmpeg. `bridge:setup` creates a project-local Python virtual environment and does not modify your global Python packages. You can instead install yt-dlp yourself, or set `BEATMAP_YTDLP` to an executable path. It is independent of browser neural mapping and receives no audio from that mode.

```sh
# macOS; install equivalent packages on other platforms
brew install ffmpeg
npm run bridge:setup
npm run bridge
```

Keep the bridge terminal open, select **YouTube link** in the studio, and paste its temporary key. Import one public video up to ten minutes. The bridge converts the download to lossless FLAC using FFmpeg; the browser encodes final Vorbis audio for the map ZIP. This avoids depending on a system FFmpeg build with libvorbis. The bridge binds only `127.0.0.1:4174`, requires its random per-run token, checks origins and restricts URLs to YouTube video IDs. Subprocess arguments are passed without a shell, downloads time out, and temporary files are removed. It does not request cookies, account credentials, playlists, private/live videos or DRM bypass. Import only audio you are authorized to use.

Use the localhost studio for the most reliable connection. A hosted studio may need browser local-network permission; some browser policies may block it. YouTube access also depends on yt-dlp/YouTube availability and may require future downloader updates. Audio-file upload is independent of this bridge.

## Import into Beat Saber

Exports use Info schema 2.0.0 and gameplay/lightshow schema 3.0.0, targeting standard objects and the built-in **Weave** environment from OST V. Keep Weave selected for the authored native lightshow. Environment overrides can disable/invalidate native fixture lighting.

- **PC:** import using a compatible custom-song loader or extract into its supported custom-level folder.
- **Quest:** import using a compatible modded custom-song loader for your particular game version.

The stock games do not directly import arbitrary map ZIPs. No Noodle Extensions or Chroma is required by these files. **Actual PC/Quest import, in-headset comfort and lightshow performance have not been verified.** The browser stage is an artistic visualization using original geometry, not an exact reconstruction of Weave or Beat Saber's lighting interpreter.

## Validation and limits

Automated tests exercise known-tempo PCM and phase recovery, silence, energy structure, 560 tempo/seed/style/difficulty combinations, note/hazard collision and parity checks, native lighting group/filter/axis/timing validation, real Ogg CRC/header checks, ZIP round-tripping, and a complete PCM-to-export integration. Browser QA additionally checks playback, controls, trimming and worker-encoded ZIP downloads. See [verification notes](docs/verification.md) for dated outcomes and remaining checks.

Tempo estimation is heuristic and may choose half/double time. Listen and adjust timing before exporting. Sections are energy-based phrase windows, not a learned verse/chorus detector. Manual variable-tempo editing, manual stem editing, custom enemies, editor-style per-note authoring, ranked-quality guarantees, and VR controller simulation are not implemented. Bombs are the game's standard hazard; arbitrary enemies are not part of this Standard export format.

## Test your own recording

```sh
BEATMAP_TEST_AUDIO="/absolute/path/to/song.mp3" npm test
```

The optional real-audio test uses local FFmpeg, checks musical-pulse coverage against an independent stored beat estimate when available, and exercises all five difficulty safeguards. It does not upload or bundle the song. A local `.local-tests/audio-fixture.json` can additionally pin the recording hash and an independently estimated beat reference; that directory is ignored by Git. The supplied “512” recording is configured this way in the development checkout. See the [real-song repair evidence](docs/verification.md#drum-first-replacement-after-second-rejection-2026-10-15) for the original failure, measured correction and limits.

## Research and architecture

Three research agents investigated format/platform support, audio features/local models, and mapping/playability. The implementation keeps musical analysis separate from choreography and show direction so stronger local models can be added without replacing the map writer.

- [Audio research and candidate small models](docs/audio-research.md)
- [Choreography research and future learned phrase scoring](docs/generation-research.md)
- [Native lightshow research, verified fixture groups and cue API](docs/lighting-research.md)
- [Export format and PC/Quest compatibility evidence](docs/compatibility.md)

**Beat This! small0** and optional **HTDemucs** run directly in browser WebGPU/WASM workers. See the provenance and measured validation above. Tiny decision models could score constrained phrase candidates, but deterministic safety checks should remain authoritative. No claim is made that a Jev-like model is already suitable or integrated.

```text
src/audio.js           decoded PCM → fast DSP/energy descriptors
src/neural-audio.js    browser Beat This! + optional HTDemucs workers
src/neural-stem-features.js  separated stems → physical attack events
src/generator.js       descriptors + controls → five choreographies
src/lighting.js        descriptors + controls → native Weave event boxes
src/preview.js         Three.js stage + approximate mouse practice
src/media.js           trim, original synth demo, audio-clock transport
src/encode.worker.js   PCM → Ogg Vorbis in a worker
src/export.js          validated Standard v3 map files → ZIP
server/bridge.mjs      optional authenticated local YouTube importer
server/beat-model.py   Beat This! beats + Demucs drum attacks (optional)
```

## License and credits

MIT. The locally synthesized demo is included under the same license. Third-party packages retain their licenses; see [notices](THIRD_PARTY_NOTICES.md). Beat Saber and its environment names are trademarks of their owners. This is an independent community project with no game assets bundled.
