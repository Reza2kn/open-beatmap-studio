# Third-party notices

Dependencies are installed from npm and pinned in package-lock.json. Their original license files are included in the installed package distributions.

- Three.js: MIT, https://github.com/mrdoob/three.js
- fflate: MIT, https://github.com/101arrowz/fflate
- wasm-media-encoders JavaScript wrapper: MIT, https://github.com/arseneyr/wasm-media-encoders
- The wrapper's Ogg/Vorbis WASM embeds Xiph reference codec libraries: BSD-style licenses, https://github.com/xiph/vorbis and https://github.com/xiph/ogg. Preserve the upstream copyright/license texts for redistribution.
- Phosphor web icons: MIT, https://github.com/phosphor-icons/web
- Space Grotesk and DM Sans fonts: SIL Open Font License 1.1, distributed by Fontsource, https://fontsource.org/
- Vite and its dependencies: respective upstream licenses, https://github.com/vitejs/vite
- yt-dlp (optional external executable): Unlicense, https://github.com/yt-dlp/yt-dlp
- FFmpeg (optional external executable): license depends on your installed build, https://ffmpeg.org/legal.html
- Beat This! (optional local model, small0 checkpoint and Python package): MIT, https://github.com/CPJKU/beat_this. Setup downloads the official checkpoint; weights are not bundled with this site.
- Demucs (optional local drum separation, htdemucs): MIT, https://github.com/facebookresearch/demucs. Official weights are downloaded during local setup and are not bundled with this site.
- PyTorch and torchaudio (optional local inference runtime): BSD-style upstream licenses, https://github.com/pytorch/pytorch and https://github.com/pytorch/audio. These packages are installed separately in the ignored local model environment.

No Beat Saber artwork, environment meshes, songs or proprietary assets are bundled. The browser stage and synth demo are generated from this project's source.
