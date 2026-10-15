# Open Beatmap Studio

A free, open source, browser-first Beat Saber map generator. Bring your audio, shape the choreography, direct a native rhythm-driven lightshow, try the map with your mouse, and export all five difficulties in one ZIP.

[Public MIT source](https://github.com/Reza2kn/open-beatmap-studio) · [Lighting research](docs/lighting-research.md) · [Verification record](docs/verification.md)

## Run locally

Node.js 22.12+ recommended (Vite requires Node 20.19+ or 22.12+).

```sh
npm install
npm run dev
```

Open the printed localhost URL. An original one-minute synth composition is generated on your device as a working demo. No recording or model weights are downloaded. Upload MP3, WAV, Ogg Vorbis, FLAC or M4A supported by your browser, up to 100 MB. Trim tracks to between 5 seconds and 10 minutes.

```sh
npm test
npm run build
npm run preview
```

## What works

- Browser audio decoding and trimming, FFT spectral-flux onsets, approximate constant BPM/phase, spectral-band balance, RMS energy and sixteen-beat phrase sections.
- Editable BPM/grid offset, half/double tempo controls, deterministic seeds, density, four choreography styles, optional walls/bombs/lighting.
- Easy, Normal, Hard, Expert and Expert+ Standard maps, with separate density/movement rules, hand alternation, parity and hazard-clearance safeguards. Difficulty names are generated profiles, not ranked-map certification.
- **Advanced native Weave lighting:** individual fixture color waves, complementary color halves, brightness gradients, index filters, eased X/Y beam rotations, distributed fans, bass/percussion accents, phrase builds and energy-jump blooms, dim rests and final blackout. No Chroma dependency. Brightness and motion controls; a dedicated lightshow view.
- Three.js browser stage, waveform seeking, playback speed/volume, mouse practice with directional red/blue cuts, score, combo, bombs and wall penalties. Left click for red and right click for blue; hold and drag in the arrow direction. Space toggles playback outside form fields.
- Worker-based real Vorbis encoding and ZIP export with `Info.dat`, five `.dat` difficulty files, `song.ogg` and square PNG cover art. Optional uploaded cover, title/artist/mapper metadata.

Audio analysis, mapping, preview, encoding and ZIP creation run on your device. No API keys, hosted inference or paid services. Assets and encoder are bundled and self-hosted. Loading the app still requires a web server; this version does not install an offline service worker.

## YouTube: optional local bridge

Direct YouTube media downloads do not reliably work inside browser CORS and media-access restrictions. A small opt-in loopback companion uses local `yt-dlp` and FFmpeg. `bridge:setup` creates a project-local Python virtual environment and does not modify your global Python packages. You can instead install yt-dlp yourself, or set `BEATMAP_YTDLP` to an executable path. It never receives your uploaded local audio.

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

Tempo estimation is heuristic and may choose half/double time. Listen and adjust timing before exporting. Sections are energy-based phrase windows, not a learned verse/chorus detector. Variable-tempo beat grids, automatic timing drift correction, exact drum/stem separation, custom enemies, editor-style per-note authoring, ranked-quality guarantees, and VR controller simulation are not implemented. Bombs are the game's standard hazard; arbitrary enemies are not part of this Standard export format.

## Research and architecture

Three research agents investigated format/platform support, audio features/local models, and mapping/playability. The implementation keeps musical analysis separate from choreography and show direction so stronger local models can be added without replacing the map writer.

- [Audio research and candidate small models](docs/audio-research.md)
- [Choreography research and future learned phrase scoring](docs/generation-research.md)
- [Native lightshow research, verified fixture groups and cue API](docs/lighting-research.md)
- [Export format and PC/Quest compatibility evidence](docs/compatibility.md)

The strongest compact learned beat-tracking lead is **Beat This! small0**. A validated ONNX/WebGPU/browser port is future work; no learned model is used in this release. Tiny decision models could score constrained phrase candidates, but deterministic safety checks should remain authoritative. No claim is made that a Jev-like model is already suitable or integrated.

```text
src/audio.js           decoded PCM → rhythmic/energy descriptors
src/generator.js       descriptors + controls → five choreographies
src/lighting.js        descriptors + controls → native Weave event boxes
src/preview.js         Three.js stage + approximate mouse practice
src/media.js           trim, original synth demo, audio-clock transport
src/encode.worker.js   PCM → Ogg Vorbis in a worker
src/export.js          validated Standard v3 map files → ZIP
server/bridge.mjs      optional authenticated local YouTube importer
```

## License and credits

MIT. The locally synthesized demo is included under the same license. Third-party packages retain their licenses; see [notices](THIRD_PARTY_NOTICES.md). Beat Saber and its environment names are trademarks of their owners. This is an independent community project with no game assets bundled.
