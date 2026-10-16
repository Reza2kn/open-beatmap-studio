# Browser audio analysis and local-model path

Research checked 2026-10-15 against primary project documentation. This document describes the browser DSP component: it makes no inference calls, downloads no weights, and sends no audio to a service. A local CPU Beat This! service is now implemented separately; see [local model setup and API](local-model.md). Update v0.5: both Beat This! and HTDemucs now run inside browser WASM workers; see [browser neural architecture](browser-neural.md). The older local-service research below is retained for provenance.

## Implemented signal path

`analyzeAudio(AudioBuffer, {bpmOverride, offsetOverride})` in `src/audio.js` accepts decoded, optionally trimmed PCM. It mixes channels, approximately low-pass filters while reducing to at most 11,025 Hz, computes centered Hann-windowed 1,024-point FFTs at a 128-sample hop, and measures positive log-magnitude spectral differences. Low/mid/high bands are weighted separately so numerous treble bins do not swamp kick transients. Adaptive local peak picking produces transient timestamps. This follows the general spectral-flux family; it does not reproduce librosa's Mel/max-filter implementation. [librosa onset-strength reference](https://librosa.org/doc/0.11.0/generated/librosa.onset.onset_strength.html).

Normalized autocorrelation estimates the global pulse over 55–200 BPM. Candidate phase fitting refines BPM against the entire onset sequence to reduce accumulated timing drift. First and second harmonics preserve half-time alternatives. A mild 115 BPM prior only breaks close ties. This uses onset/correlation principles documented by librosa; our constant-grid phase fitting differs from its dynamic-programming tracker. [librosa beat tracker](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html).

The output contract is:

```js
{
  bpm, offset, duration, confidence, // seconds except BPM; confidence 0–1 heuristic
  onsets: [{time, strength, low, mid, high}], // time seconds; others normalized
  sections: [{start, end, energy, label}],   // seconds; label quiet/build/peak/flow
  waveform: [/* 800 normalized absolute peak bins */],
  energy: [/* normalized centered frame RMS */],
  beatTimes: [/* constant-grid seconds within audio */],
  frameDuration, // energy[i] is centered at i * frameDuration
  tempoCandidates: [{bpm, score}],
  method: 'spectral-flux-autocorrelation', silent
}
```

Onset bands are spectral-flux proportions, **not** instrument labels. Sections are contiguous sixteen-beat energy windows, **not** learned chorus/downbeat/drop annotations. Confidence is an uncalibrated diagnostic; half/double ambiguity reduces it. A silent file returns no onset/beat events and zero confidence. The fallback BPM of 120 enables subsequent manual editing and is not a detected tempo. BPM overrides 30–300 and offset overrides −60–60 seconds are accepted exactly; negative offsets retain only nonnegative beat times. Trim the AudioBuffer before analysis so export audio and generated timestamps share a zero point. The analyzer periodically yields to the event loop.

Limitations: sustained vocals, rubato, syncopation, tempo changes, long intros, meter changes and unusually weak beats can all defeat a single global grid. Band averaging and the box resampler trade audio-analysis precision for a small dependency-free implementation. No downbeat/meter estimate is returned. Users should audition and correct BPM/phase, especially low-confidence results. Synthetic tests verify known click timing, half-time reporting, overrides, silence, and shape invariants; no real-music accuracy benchmark has been run.

## A credible tiny local model

**Beat This! small0** is now available through the local CPU service: the authors provide beat and downbeat inference and list their smaller checkpoints at about **8.1 MB**, compared with 78 MB for the main model. The official implementation requires PyTorch and related Python dependencies; CPU inference is supported. Its present interface is Python, not a ready-to-run browser package. [Official model repository](https://github.com/CPJKU/beat_this). Repository code is MIT licensed. [License](https://github.com/CPJKU/beat_this/blob/main/LICENSE).

Proposed implementation: export the smaller network to ONNX, replicate and validate the exact audio/spectrogram preprocessing, use quantization only after beat/downbeat timing regression tests, run overlapping chunks in a worker, and compare against the official Python outputs. ONNX Runtime Web offers WASM and accelerated providers; WASM covers all ONNX operators while GPU providers support subsets. Therefore an ONNX export and operator/runtime validation are necessary before promising browser compatibility. Prefer WASM as the baseline and WebGPU where validated. [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/), [WebGPU guidance](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).

A generic tiny language/decision model is unnecessary for timestamping or hard gameplay constraints. An optional later policy model could select a small vocabulary of validated motifs from beat/section features; deterministic scheduling and collision checks must still enforce valid output. This is an architectural inference, not a measured comparison. The first worthwhile neural upgrade is a music-specialist beat/downbeat estimator, followed by evaluated phrase/drop detection, rather than token-generating raw map JSON.

## YouTube and browser boundaries

The YouTube IFrame API provides player controls and playback state. It does not provide decoded PCM or a general audio-download interface. Browsers restrict script access to cross-origin resources unless the remote server opts in through CORS, so entering a public YouTube page URL is not enough to obtain analyzable audio. [YouTube player API](https://developers.google.com/youtube/iframe_api_reference), [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

The practical open-source route is an optional loopback helper using **yt-dlp + native ffmpeg**, with local-file upload remaining entirely browser-local. yt-dlp recommends ffmpeg/ffprobe and a JavaScript runtime; current full YouTube support also uses yt-dlp-ejs. Site extractor behavior can change, so show actionable dependency/extraction errors. [yt-dlp README](https://github.com/yt-dlp/yt-dlp/blob/master/README.md).

ffmpeg.wasm can transcode files already available to the browser; it does not bypass remote-origin access controls or supply a YouTube extractor. Its upstream FAQ reports slower performance than native ffmpeg and higher memory/CPU use with multithreading. Wrapper licensing differs from the compiled core and included libraries. [ffmpeg.wasm FAQ](https://ffmpegwasm.netlify.app/docs/faq/).

The local helper should accept only explicit YouTube URLs, bind to loopback, avoid shell interpolation, limit duration/output sizes, discard temporary artifacts, and require a per-session token for mutable requests. Those are implementation recommendations, not a substitute for verifying the actual bridge. Only download content the user has permission to use.

## Real-song timing correction, 2026-10-15

User testing on “Mora x Jhay Cortez - 512 (Video Oficial).mp3” exposed a failure not covered by the original synthetic click tests. Equal musical content at different channel-mix gain could flip the nearly tied 88/176 BPM candidates. The second-harmonic phase fit returned only one modulo-half-period branch, allowing the full map to move about 170 ms from the supported drum phase. Coarse BPM rounding introduced additional drift. The mono failing case returned 176 BPM and .062341 s; stereo happened to choose 88.02 BPM/.249943 s.

The analyzer now normalizes its analysis gain, refines onset peaks to local energy-rise edges, resolves both phase branches against observed attacks, retains sub-centesimal BPM precision, and consistently resolves close high/half-time alternatives toward the slower human pulse. The latter is an explicit tempo-ambiguity heuristic, not a universal meter detector. Precise observed `rhythmEvents` are supplied separately from estimated grid beats, so map notes need not be snapped onto unsupported grid slots. `retimeAnalysis` rebuilds analytical-grid metadata while preserving these attack timestamps.

A local CPU run of the official [Beat This! small0](https://github.com/CPJKU/beat_this) served as an independent reference, not as the production browser model and not as annotated truth. Its reliable main-body fit over 8–160 s was approximately 88.002 BPM/.251631 s. The corrected browser DSP returned 87.998 BPM/.2515–.2519 s across the tested mono/stereo, 11.025/44.1/48 kHz, and gain variations. Median disagreement with reference beat estimates was 7.7–8.0 ms; p90 was 18.3–18.7 ms. The failing old mono path had median disagreement about 154 ms. Tail model mistakes were excluded from this comparison.

On the strongest low-band subset, onset-edge refinement reduced median signed early bias from about −17.8 ms to approximately zero, but a few late-edge outliers remained; p90 absolute attack error did not improve uniformly. These measurements support the specific timing correction, not a guarantee of musical taste on arbitrary songs. The recording and reference beat timestamps remain local and ignored by Git. Public tests include a synthetic syncopated kick/snare regression and fine-tempo precision checks; an optional configured private-song regression runs against the user's exact file locally.
