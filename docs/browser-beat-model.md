# Browser Beat This! model

`analyzeNeuralBeats(audioBuffer, {onProgress, signal})` in `src/neural-beat.js` runs genuine Beat This! small0 inference in a dedicated ONNX Runtime Web worker, preferring WebGPU with a fresh-worker WASM fallback. `onProgress` receives `{stage,progress}` with progress in 0–1 per stage. The result has the same beat/downbeat/timing fields as the local Python helper and can be passed to `applyBeatModel`. The worker terminates on completion, error or cancellation, releasing its model session before source-separation inference. No companion, API key or audio upload is involved. The browser downloads static model/runtime assets from the application host.

## Conversion and provenance

The MIT-licensed official [Beat This! source](https://github.com/CPJKU/beat_this) and pinned small0 checkpoint are used. `tools/export-beat-onnx.py` verifies the checkpoint SHA-256, disables rotary-cache tracing and exports a dynamic time-axis ONNX opset-17 graph using PyTorch 2.8. It also exports the exact torchaudio Slaney mel bank. The model manifest records checkpoint/file digests and numerical validation. The original MIT license is distributed alongside the assets.

Reproduce with the existing local model environment:

```sh
uv pip install --python .model-venv/bin/python onnx==1.19.1 onnxruntime==1.23.2
.model-venv/bin/python tools/export-beat-onnx.py
```

The ONNX graph is 9,491,837 bytes, with a 262,656-byte mel bank. ONNX Runtime Web 1.30.0's SIMD WASM binary adds approximately 14 MB plus JavaScript. Runtime files are bundled as same-origin Vite assets, not fetched from a third-party CDN. WebGPU uses the matching 1.30.0 asyncify runtime, transported as a 6.6 MB gzip with compressed/uncompressed integrity checks; do not pair the newer native GPU backend with the legacy JSEP binary. WASM uses one thread, so ordinary HTTPS hosting does not require cross-origin isolation. Browser SIMD support and sufficient memory are required; mobile performance has not been established.

## Preserved inference behavior

The audio path mixes to mono and resamples to 22,050 Hz with Web Audio's offline resampler when needed. At 22,050 Hz, preprocessing follows the official pipeline: centered reflected 1024-sample STFT, periodic Hann, hop 441, magnitude divided by 32, exact 128-bin Slaney bank, then `log1p(1000*x)`. The worker reproduces 1,500-frame chunks, six-frame borders, shifted final chunks and `keep_first` overlap. Postprocessing reproduces the official seven-frame maxima, positive-logit threshold, adjacent-peak handling and nearest-beat downbeat alignment. Fitted BPM/offset summarize coordinates without replacing model timestamps. The model remains a pulse predictor; it does not identify all individual drum hits or guarantee correct meter.

Full supplied recording validation used identical private 22,050 Hz PCM for the Python and JS pipelines. Across 9,794 frames, JS log-mel mean absolute error was 4.66e-7 and maximum error 1.64e-4. Actual ONNX Runtime Web WASM inference (under Node, using the browser runtime rather than native ONNX Runtime) produced exactly the same 280 beats, 100 downbeats, 88.001 BPM and .251726-second offset as Python. Maximum full-track beat/downbeat logit errors were 5.63e-5 / 2.96e-5. Single-thread execution took 18.17 seconds on the tested computer; that is not a browser/mobile latency guarantee. Browser decoding/resampling can differ slightly from FFmpeg/soxr, and threshold-adjacent peaks may consequently differ. The recording and private parity artifacts are not distributed.

## Isolated-stem feature extraction

`extractNeuralStemFeatures({drums,other,vocals}, sampleRate=22050)` in `src/neural-stem-features.js` accepts equally sized mono `Float32Array` stems. It returns `percussionEvents`, `melodicEvents`, source/method labels and `drumQuality`. It ports the production Python attack detectors: physical waveform energy rises for core drums, independent band novelty/refinement for quieter details, and tonal attacks plus vocal-leakage vetoes for the instrument stem. Event timestamps are never quantized to a grid. `detail` denotes optional salience; it does not imply a hi-hat.

The browser FFT pads attack-classification windows to powers of two, and its zero-phase band filters differ from scipy's third-order Butterworth filters. Nevertheless, a complete retained independent stereo stem fixture produced the same 508 percussion and 488 melodic events in JS and Python, with 100% bidirectional event agreement within 12 ms. JS extraction took 2.4 seconds on this computer. This is a port-parity check on estimated stems, not manually annotated source accuracy. Source leakage, omitted quiet hits and heuristic confidence remain limitations.
