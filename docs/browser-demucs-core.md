# HTDemucs core with JavaScript inverse STFT

The pinned MIT StemSplit export contains a fully unrolled inverse-STFT envelope. Its 24,917-node graph failed the tested ONNX Runtime Web 1.30 WebGPU path at a `/real_istft/ConstantOfShape` provider-copy boundary. This is a graph/runtime compatibility failure, not evidence that neural convolutions inherently require the CPU.

`tools/export-demucs-browser.py` verifies the original 165,612,636-byte graph's SHA-256 (`d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a`) and extracts the unchanged neural network ending before inverse STFT. The resulting graph has 3,756 nodes and 118,419,452 bytes, with no retraining, quantization change or substituted model. Its serialized SHA-256 is recorded in `public/models/demucs-gpu-manifest.json` alongside ordered transport-shard digests. Six 18 MiB files and one smaller file concatenate into one ordinary ONNX model. Individual `.bin` shards are transport pieces, not independently executable models. Both Meta and StemSplit MIT licenses are distributed beside them.

## Integration contract

- Input `mix`: float32 `[1,2,343980]`, stereo 44.1 kHz, channel-major.
- Output `/Pad_2_output_0`: float32 `[1,4,2,2,2049,340]`, ordered batch / stem / stereo / real-imaginary / frequency / frame. This includes the Nyquist bin and the model's frame padding.
- Output `/Add_4_output_0`: float32 `[1,4,2,343980]`, the already denormalized time branch.
- Stem order: drums, bass, other, vocals.

`reconstructNeuralStems(spectra,time)` in `src/neural-istft.js` accepts flat arrays or ORT tensors and returns a flat float32 `[4,2,343980]` waveform tensor. It performs an orthonormal 4096-point inverse transform, periodic Hann synthesis and squared-window overlap normalization with hop 1024. The crop is 3584 samples: the inverse transform's center crop 2048 plus Demucs' outer crop 1536. The frequency waveform is added to the time branch exactly once. It introduces no beat-grid offset or quantization.

The existing audio FFT only bit-reverses its real input. The reconstruction explicitly permutes the nonzero imaginary input as well before using those butterflies; omitting this corrupts complex inverse transforms. Public tests independently cover overlapping tones, channel layout and a known-time impulse.

## Validation and limits

On the retained private stereo 7.8-second excerpt spanning introductory music and drum entry, native ONNX Runtime evaluated the cut and original graphs using identical input. JavaScript inverse STFT plus the cut graph's time branch was then compared against the original graph's complete waveform output, over all four stereo stems:

| Measurement | Result |
|---|---:|
| Samples compared | 2,751,840 |
| Mean absolute waveform error | 4.06e-6 |
| Maximum absolute waveform error | 9.51e-5 |
| RMS waveform error | 6.98e-6 |
| JavaScript reconstruction runtime | 0.76 seconds |

The same cut-graph outputs plus JavaScript reconstruction were also compared directly against the cached official PyTorch HTDemucs forward pass on that identical excerpt. Mean absolute error was 8.72e-6, maximum error 5.46e-4, with per-stem correlations above .99999997. The export/reconstruction keeps both the frequency and time branches; it does not substitute a time-only estimate.

These establish reconstruction fidelity on that excerpt, not source-separation accuracy or GPU throughput. The runtime is a local Node measurement and is not a mobile/browser latency guarantee. Actual GPU model execution, adapter memory limits, CPU fallback and whole-track export require separate browser validation. Estimated source leakage and event-selection limitations remain unchanged. Private audio, waveforms and per-sample comparison assets remain ignored.

Primary implementation sources: [StemSplit real STFT/inverse STFT](https://github.com/StemSplit/demucs-onnx/blob/main/src/demucs_onnx/export/stft.py), [Meta Demucs](https://github.com/facebookresearch/demucs), [ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html).
