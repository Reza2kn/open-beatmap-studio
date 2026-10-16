# Local learned beat analysis

> Legacy optional Python helper: the default v0.5 neural mode now runs entirely in the browser. No setup below is needed for uploaded-file mapping. See [browser neural mode](browser-neural.md).

`server/beat-model.py` runs **Beat This! small0** on the user's CPU and can also run **htdemucs learned drum separation** with `--separate-drums`. Beat timestamps/probabilities come from the beat model; drum-hit events come from waveform attacks in the independently estimated drum stem. The fitted constant BPM is a coordinate system for export, not a replacement for those event times.

The authors provide beat/downbeat inference, CPU operation, small checkpoints of about 8.1 MB and main checkpoints of about 78 MB. Their code and released weights are MIT licensed. Their documented implementation is Python/PyTorch; the browser port described below is not shipped. [Official project](https://github.com/CPJKU/beat_this).

## Setup and commands

```sh
npm run model:setup
npm run build
npm run bridge
```

Setup creates an isolated `.model-venv` with Python 3.12 when `uv` is available, or an installed Python 3.10–3.13 otherwise. `BEATMAP_MODEL_PYTHON` can select an interpreter. It installs pinned `beat-this==1.1.0`, `demucs==4.0.1`, `torch==2.8.0` and matching `torchaudio==2.8.0`; Windows/Linux setup selects PyTorch's official CPU wheel index before installing remaining packages. The Python runtime requires several hundred MB depending on platform; weight downloads add about 8.5 MB for small0 and 84 MB for htdemucs.

Setup explicitly downloads the official checkpoints into ignored `.model-cache/` and verifies their pinned SHA-256 hashes. small0: `6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b`; htdemucs: `8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4`. Normal inference requires cached checkpoints and makes no network calls. Audio, PCM and estimated stems remain in memory and are never written by the production script. Only initial package/weight installation requires an internet connection.

For the browser UI, open `http://127.0.0.1:4174/connect` and use **Connect & open studio**. The companion serves the build from `dist/` and establishes a same-origin, HttpOnly session through a single-use local form. Neural mode is selected automatically; reloads retain the connection for that browser session. Model APIs still require either this local session or an explicit bearer key. The hosted frontend offers the local-studio link and retains optional manual bearer authentication; it does not receive the cookie session. A companion restart invalidates sessions. The Python CLI below is unchanged.

```sh
# JSON readiness check; does not load the model or analyze audio.
.model-venv/bin/python server/beat-model.py --status

# Explicit setup-only weight download / checksum verification.
.model-venv/bin/python server/beat-model.py --download --separate-drums

# A local file, optionally trimmed in seconds; FFmpeg decodes only in memory.
.model-venv/bin/python server/beat-model.py '/path/to/song.mp3' --trim-start 0 --trim-end 180

# Also estimate a learned drum stem and return physical drum-hit events.
.model-venv/bin/python server/beat-model.py '/path/to/song.mp3' --separate-drums

# The browser bridge sends already trimmed mono little-endian float32 PCM.
.model-venv/bin/python server/beat-model.py --stdin-f32 --sample-rate 22050

# The production learned-drums bridge mode adds this flag; CPU minutes expected.
.model-venv/bin/python server/beat-model.py --stdin-f32 --sample-rate 22050 --separate-drums

# Fast helper tests; no song assets or weight download needed by these tests.
.model-venv/bin/python server/test-beat-model.py
```

The stdin command reads until EOF. Its maximum duration is ten minutes. File decoding requires FFmpeg; PCM stdin does not. `--threads` accepts 1–16 and defaults to at most four CPU threads. `BEATMAP_MODEL_CACHE` can change the cache directory, and `BEATMAP_FFMPEG` can select a native decoder. Errors are a single JSON object and a nonzero exit code. Stdout is always one JSON document; incidental library logs are redirected to stderr.

## Signal path and output

The script uses the author's `Audio2Frames`, including exact log-Mel preprocessing, overlapping 1,500-frame inference chunks and the official minimal peak postprocessor. The latter selects model maxima above probability .5 at 50 frames/second, removes adjacent duplicates and aligns downbeats to nearby predicted beats. Frame logits are converted to probabilities once; there is no second DSP detector substituted for these learned beats. [Inference source](https://github.com/CPJKU/beat_this/blob/main/beat_this/inference.py), [postprocessor source](https://github.com/CPJKU/beat_this/blob/main/beat_this/model/postprocessor.py).

```js
{
  schemaVersion: 1,
  model: {
    id: 'beat-this-small0', name: 'Beat This! small0',
    packageVersion, checkpointSha256, device: 'cpu', frameRate: 50,
    postprocessor: 'official-minimal', license: 'MIT', learned: true
  },
  duration, bpm, offset, confidence,
  beatTimes: [/* exact model prediction times in seconds */],
  downbeatTimes: [/* exact official postprocessed downbeat times */],
  beats: [{ time, confidence, downbeatProbability, isDownbeat }],
  activations: {
    frameDuration: 0.02,
    beatProbabilities: [/* frame i corresponds to i * .02 seconds */],
    downbeatProbabilities: [/* same frame convention */]
  },
  quality: {
    beatCount, downbeatCount, meter, meterConfidence,
    beatConfidenceMean, irregularIntervalFraction, gridResidualMedianSeconds
  },
  warnings: [], elapsedSeconds
  // When --separate-drums is enabled:
  // percussionSource: 'demucs-htdemucs',
  // percussionMethod: 'learned-drum-stem',
  // percussionEvents: [{time,strength,kind,confidence,low,mid,high,
  //                     percussiveRatio:1,source:'demucs-htdemucs'}],
  // melodicSource: 'demucs-htdemucs-other',
  // melodicMethod: 'tonal-attacks-vocal-veto',
  // melodicEvents: [{time,strength,kind:'melodic',confidence,
  //                 source:'demucs-htdemucs-other',tonalConfidence,
  //                 attackContrast,spectralChange,vocalDominance,
  //                 vocalCoherence,instrumentMethod:'tonal-attacks-vocal-veto'}],
  // drumQuality: {model,checkpointSha256,device,inputSampleRate,inputMono,
  //               separatorSampleRate,eventCount,activeRanges:[{start,end}],
  //               onsetMethod,confidenceIsHeuristic,elapsedSeconds}
}
```

All times are relative to the supplied trimmed audio, with zero additional offset. `bpm`/`offset` describe a robust constant-grid fit to the model events for export coordinates. They do not snap, move, add or delete model timestamps. Beat `confidence` and frame probabilities are uncalibrated model scores. Top-level `confidence` summarizes concentration/consistency and is not an accuracy probability. `meter` stays null unless downbeat spacing consistently supports three or four beats per bar. An empty/silent signal emits no beat events; too few learned beats produce zero timing confidence. Missing tail predictions remain empty.

## What a beat model does not solve

A beat predictor identifies perceived musical pulse; it does not identify individual kick, snare or hi-hat attacks. A rhythmic passage can have a beat with no audible drum onset, or multiple syncopated drums between beats. Therefore placing a note on every predicted beat still does not fulfill drum-led mapping. Percussion detection/separation and difficulty selection are separate stages. Harmonic/percussive median filtering can isolate transient structure but also includes piano attacks and vocal consonants. It is statistical source separation, not a semantic drum classifier. [HPSS reference](https://librosa.org/doc/0.11.0/generated/librosa.decompose.hpss.html).

With `--separate-drums`, the script loads the pinned official htdemucs checkpoint from disk, runs CPU separation with shifts 0 / overlap .1, then finds waveform-energy rise events in the estimated drums. It returns genuine stem attack timestamps, not extrapolated grid pulses. Input mono PCM is resampled to the separator's 44.1 kHz rate and repeated across its stereo input channels; the estimated drum stem is reduced back to mono for hit analysis. This is a larger, slower local operation than small0. The authors document the drum/bass/vocal/other sources and CPU mode. [Demucs project](https://github.com/facebookresearch/demucs).

Drum events use 5 ms waveform energy, positive 12 ms changes, an 85 ms refractory distance and prominence above 1.5% of the track's strongest drum rise. `strength` is rise/global peak, while `confidence` is a heuristic .55 + .4*sqrt(strength), not a separator probability. `kind` uses the estimated attack's spectral proportions and is a rough kick/snare/hat label. `percussiveRatio:1` identifies an isolated-source path; it is not a measured claim of perfect separation. `activeRanges` merges one-second stem RMS windows above 2.5% of the strongest such window; start/end values are seconds. Separators can leak vocals/piano or miss drums, and quieter attacks still require conservative pattern selection.

## Local recording checks

The supplied 195.86-second recording was processed entirely locally. small0 returned 280 learned beats and 100 downbeats, with a descriptive 88.001 BPM / .251726-second grid. The file-input and PCM-stdin paths produced exactly equal beat arrays. A first run took 11.96 seconds of model load/inference on the tested CPU; a concurrent run took 20.47 seconds, so this is not a latency guarantee. The first times are .24, .94, 1.62, 2.30, 2.98 and 3.68 seconds. These are model estimates, not manual annotations.

An independent final0 run returned 279 beats and 82 downbeats. It produced more consistent four-beat bar spacing in the 22–64 and 160–188-second passages, but still confused bars in the 64–128-second passage. Both models require meter review. The track fades sharply after 188 seconds; waveform RMS drops from .143 at 188 seconds to .0088 at 189 and .0003 at 191, so filling the last seconds with extrapolated notes would manufacture hits. Private diagnostics/outputs stay in ignored `.local-tests/`; no user song or stem is part of the public test suite.

### Independent drum-stem check

An **official htdemucs** CPU separation was run locally as an independent diagnostic, using shifts 0 and overlap .1. Its estimated drum stem had no detected hits before about **22.07 seconds**, while its RMS increased from .00014–.00066 in introductory passages to .128 during the first full groove. The early piano/vocal material must not be relabeled as drums merely because it produces onset peaks. The strong drum pattern begins at approximately 22.070, 22.567, 22.736, 23.078, 23.433, 23.930, 24.109 and 24.440 seconds: relative to the pulse it follows **0, .75, 1, 1.5, 2, 2.75, 3, 3.5**, rather than uniform half-beat spacing.

The initial browser HPSS detector emitted 740 candidates, including 41 before drum entry. Against waveform-rise events extracted from the independently learned stem, 60.4% of those candidates were within 40 ms of a stem event, while 98.3% of stronger stem events were covered. Matched-event timing was already close (median 2.72 ms); over-selection and instrument confusion were the larger problems. Requiring percussive ratio above .5 and normalized strength above .4 improved candidate agreement to 87.3% while retaining 96.8% of stronger stem events, although four introductory false candidates remained. These thresholds are diagnostic evidence for conservative selection, not a universal drum classifier or an accuracy benchmark.

This comparison uses two fallible estimators, so “agreement” and “coverage” are deliberate terms; there are no manual ground-truth drum annotations. The independent stereo-reference stem and full per-event diagnostic outputs remain local/ignored. The production `--separate-drums` mode now exposes that slower learned-separation approach explicitly; it processes input PCM in memory and returns only event/features JSON. The browser HPSS mode remains a separate statistical approximation.

A full production CLI check on the same recording returned **476 drum-hit events, none before 22 seconds**. Learned separation took 86.32 seconds and the combined beat/drum stages took 90.68 seconds with cached weights on this CPU. The production mono-input path agreed with 97.9% of independent stereo-stem events within 40 ms, with 98.1% reverse coverage. The activity ranges were 22–34, 35–88, 90–112, 114–164 and 177–189 seconds. These machine-specific measurements establish that the production path actually ran; they do not guarantee song quality, latency on other computers, or exact source-separation truth.

## Browser-only feasibility

A browser version has a credible route: export the fixed-length spectrogram model to ONNX, run it in a worker, implement matching resampling/STFT/Slaney-Mel/log preprocessing, reproduce the official overlap/crop policy, and retain the same postprocessor. PyTorch provides an ONNX exporter; ONNX Runtime Web provides WASM and GPU execution backends, with operator support varying by provider. [PyTorch export documentation](https://docs.pytorch.org/tutorials/beginner/onnx/export_simple_model_to_onnx_tutorial.html), [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).

The existing checkpoint sizes establish an approximate model-download budget: ~8 MB for small0 or ~78 MB for a main model, plus the browser inference runtime and any converted graph overhead. They do not establish browser RAM usage or throughput. The network includes partial time/frequency transformers and rotary attention, so conversion/operator coverage and timing parity require measurement. No working ONNX conversion, browser benchmark or browser-only learned inference is claimed in this release. The shipped learned path uses the local bridge; the DSP preview/export path remains browser-local.


## Layered rhythm update (v0.3.1)

The production separator also reads its `other` instrument stem, detects its actual attacks and returns `melodicEvents` / `melodicSource`. This makes piano/backing-instrument rhythms available during drum sections as well as the intro. Band-balanced spectral flux and band-filtered energy rises recover quieter drum detail that full-band kick energy can hide. Detail candidates retain physical timestamps; they do not fill an imagined uniform grid. Harder profiles admit progressively more of those events, with 32nd-note candidates reserved for isolated percussion or the most detailed instrumental profile. Note clicks are enabled by default and counted as distinct timestamps, not simultaneous saber objects.

## Instrument selection correction (v0.4)

An audit found that the shared detector had also applied its drum-detail extractor to the `other` stem. Band-normalized brightness changes in reverberation, sustained instruments and separator residues could consequently become extra melodic notes. The instrument path now explicitly disables that drum-detail detector. It requires an audible tonal attack and checks the simultaneously estimated vocal stem for leakage; the drum detector remains separate.

For each instrument candidate, `attackContrast` is RMS after the attack (+5 to +40 ms) divided by RMS before it (−50 to −15 ms). `spectralChange` is one minus the cosine similarity of the before/after magnitude spectra. `tonalConfidence` is one minus spectral flatness over 90–6000 Hz. Candidates require tonal confidence at least .65 and either contrast at least 1.3, or spectral change at least .18 with contrast at least .85. A track-relative audible floor rejects very faint residues. Over a 100 ms window, `vocalDominance` is vocal RMS/instrument RMS and `vocalCoherence` is absolute waveform cosine similarity; dominance above 15, or dominance above 4 with coherence above .18, vetoes a candidate. These are conservative heuristics, not calibrated probabilities or a learned instrument classifier. A real quiet instrument under loud vocals may be omitted. No filename or song-specific condition is used.

The actual full production CLI on the supplied recording returned 511 percussion events (476 core plus 31 mid-band details and four high-band details) and 373 tonal instrument events, in 83.27 seconds on the tested CPU. An independent diagnostic used a separately run stereo-input htdemucs estimate and a different analytic-amplitude rise detector, without reading map `sourceTime` fields or calling the production onset extractor. Over 0–188 seconds, instrument candidates agreeing with independent attacks within 20 ms increased from 53.5% to 75.9%, and agreement within 40 ms increased from 78.2% to 94.1%. Candidates farther than 80 ms from an independent attack fell from 60 to one. This compares the old 1,274 candidates in that interval with the new 373; it is not a fixed-size benchmark or manual accuracy annotation.

All ten production hat candidates, including the four added high-band details, agreed with independent high-band rises within 20 ms; 30 of 31 mid-band detail candidates agreed with independently measured 350–2000 Hz rises within 20 ms. A `detail` flag denotes optional salience, not a high-frequency instrument label. These checks do not establish that every quieter hat was detected; lowering a threshold solely to increase note counts would not establish that either.

For reconstructed previous-generation maps, independently measured core snare timing had a median scheduled-minus-reference difference of about +1 ms, and kick medians ranged from +2 to +6 ms by passage. The independent detector itself backtracked approximately 2–3 ms early on known synthetic attacks. Original MP3 versus retained exported Ogg waveform correlation found zero sample lag in five separated passages. These results argue against a single global offset correction; the instrument-selection bug and individual band refinement errors require their own fixes. Remaining differences, separator artifacts and perceptual timing still need listening review. Private song/stem diagnostics remain ignored and are not distributed as test assets.
