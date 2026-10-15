#!/usr/bin/env python3
"""Offline CPU Beat This! inference. Stdout is one JSON document; logs go to stderr.

The beat/downbeat arrays are model predictions, not a substituted fixed grid.
Only --download accesses the network. Audio and decoded PCM are never written.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(os.environ.get("BEATMAP_MODEL_CACHE", ROOT / ".model-cache")).expanduser().resolve()
CHECKPOINT = CACHE / "beat_this-small0.ckpt"
CHECKPOINT_URL = "https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt"
CHECKPOINT_SHA256 = "6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b"
DRUM_CHECKPOINT = CACHE / "hub" / "checkpoints" / "955717e8-8726e21a.th"
DRUM_CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th"
DRUM_CHECKPOINT_SHA256 = "8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4"
MAX_DURATION = 600
FPS = 50


def emit(value):
    print(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")), flush=True)


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def runtime_status():
    packages = {}
    missing = []
    for package, module in [("torch", "torch"), ("torchaudio", "torchaudio"), ("beat-this", "beat_this"), ("numpy", "numpy"), ("soxr", "soxr")]:
        try:
            packages[package] = importlib.metadata.version(package)
            if importlib.util.find_spec(module) is None:
                missing.append(package)
        except importlib.metadata.PackageNotFoundError:
            missing.append(package)
    weights_ready = CHECKPOINT.is_file() and CHECKPOINT.stat().st_size > 1_000_000 and digest(CHECKPOINT) == CHECKPOINT_SHA256
    drums_present = importlib.util.find_spec("demucs") is not None and importlib.util.find_spec("scipy") is not None
    drum_weights = DRUM_CHECKPOINT.is_file() and DRUM_CHECKPOINT.stat().st_size > 1_000_000 and digest(DRUM_CHECKPOINT) == DRUM_CHECKPOINT_SHA256
    return {"ready": not missing and weights_ready, "local": True, "device": "cpu", "model": "beat-this-small0",
            "python": sys.version.split()[0], "packages": packages, "missingPackages": missing,
            "weightsReady": weights_ready, "drumWeightsReady": drum_weights,
            "drumsReady": not missing and weights_ready and drums_present and drum_weights,
            "separator": "demucs-htdemucs", "setupCommand": "npm run model:setup"}


def download(path=CHECKPOINT, url=CHECKPOINT_URL, checksum=CHECKPOINT_SHA256, limit=16 * 1024 * 1024):
    """Fetch only an explicit pinned official artifact, atomically and bounded."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.stat().st_size > 1_000_000 and digest(path) == checksum:
        return {"downloaded": False, "bytes": path.stat().st_size, "sha256": digest(path)}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix="model-", suffix=".partial", delete=False) as target:
            temporary = Path(target.name)
            request = urllib.request.Request(url, headers={"User-Agent": "OpenBeatmapStudio/0.3 local-setup"})
            size = 0
            with urllib.request.urlopen(request, timeout=60) as response:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise RuntimeError("Official model checkpoint exceeded the expected size limit.")
                    target.write(chunk)
        if size < 1_000_000:
            raise RuntimeError("The model download was incomplete. Run setup again.")
        if digest(temporary) != checksum:
            raise RuntimeError("Official model checkpoint checksum did not match this release. No weights were installed.")
        temporary.replace(path)
        return {"downloaded": True, "bytes": size, "sha256": digest(path)}
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def decode_audio(args, np):
    """PCM stays in memory; file mode additionally requires local native ffmpeg."""
    if args.stdin_f32:
        if args.audio:
            raise ValueError("Choose a local audio file or --stdin-f32, not both.")
        sr = args.sample_rate
        if not 8000 <= sr <= 48000:
            raise ValueError("PCM sample rate must be between 8000 and 48000 Hz.")
        limit = MAX_DURATION * sr * 4
        raw = sys.stdin.buffer.read(limit + 4)
        if len(raw) > limit:
            raise ValueError("Please trim audio to ten minutes or less before model analysis.")
        if len(raw) % 4:
            raise ValueError("PCM input must contain complete little-endian float32 samples.")
        signal = np.frombuffer(raw, dtype="<f4").copy()
        start = round(args.trim_start * sr)
        end = round(args.trim_end * sr) if args.trim_end is not None else len(signal)
        signal = signal[start:end]
    else:
        if not args.audio:
            raise ValueError("Provide a local audio file or --stdin-f32.")
        audio = Path(args.audio).expanduser().resolve(strict=True)
        if not audio.is_file():
            raise ValueError("Audio input must be a local file.")
        sr = 22050
        requested = args.trim_end - args.trim_start if args.trim_end is not None else MAX_DURATION
        # A tiny over-read rejects untrimmed long tracks rather than silently truncating them.
        length = min(MAX_DURATION, requested) + .05
        command = [os.environ.get("BEATMAP_FFMPEG", "ffmpeg"), "-nostdin", "-v", "error", "-i", str(audio),
                   "-ss", str(args.trim_start), "-t", str(length), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"]
        try:
            completed = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=120, check=False)
        except FileNotFoundError as exc:
            raise RuntimeError("FFmpeg is required for local file decoding. Install it or send --stdin-f32 PCM.") from exc
        if completed.returncode:
            raise ValueError("FFmpeg could not decode this audio file. Try WAV, MP3, FLAC, M4A or Ogg audio.")
        signal = np.frombuffer(completed.stdout, dtype="<f4").copy()
        if args.trim_end is not None:
            signal = signal[:round(requested * sr)]
        if len(signal) > MAX_DURATION * sr:
            raise ValueError("Please trim audio to ten minutes or less before model analysis.")
    if len(signal) < sr * .1:
        raise ValueError("Provide at least 0.1 seconds of audio.")
    if not np.isfinite(signal).all():
        raise ValueError("Audio PCM contains non-finite samples.")
    return signal, sr


def timing_summary(times, confidence, downbeats, np):
    """Describe a grid for export coordinates without replacing predicted times."""
    if len(times) < 4:
        return {"bpm": 120.0, "offset": float(times[0]) if len(times) else 0.0, "confidence": 0.0,
                "quality": {"beatCount": len(times), "downbeatCount": len(downbeats), "meter": None, "meterConfidence": 0.0,
                            "irregularIntervalFraction": 1.0, "gridResidualMedianSeconds": None}}
    intervals = np.diff(times)
    valid_intervals = intervals[(intervals > .25) & (intervals < 1.5)]
    period = float(np.median(valid_intervals if len(valid_intervals) else intervals))
    rough_bpm = max(40.0, min(240.0, 60 / period))
    weights = np.clip(np.asarray(confidence, dtype=np.float64), .01, 1)
    best = (-1.0, rough_bpm, 0.0)

    def scan(candidates):
        nonlocal best
        for bpm in candidates:
            z = np.sum(weights * np.exp(2j * np.pi * times * bpm / 60))
            coherence = float(abs(z) / weights.sum())
            if coherence > best[0]:
                best = (coherence, float(bpm), float(np.angle(z) % (2 * np.pi) / (2 * np.pi) * 60 / bpm))

    scan(np.arange(max(40, rough_bpm * .96), min(240, rough_bpm * 1.04), .01))
    scan(np.arange(best[1] - .015, best[1] + .015, .001))
    coherence, bpm, offset = best
    period = 60 / bpm
    indices = np.rint((times - offset) / period)
    residual = times - (offset + indices * period)
    good = np.abs(residual) < min(.08, period * .15)
    if good.sum() >= 8:
        slope, intercept = np.polyfit(indices[good], times[good], 1, w=np.sqrt(weights[good]))
        if slope > 0 and abs(slope / period - 1) < .02:
            period, bpm, offset = float(slope), float(60 / slope), float(intercept % slope)
    residual = np.abs((times - offset + period / 2) % period - period / 2)
    irregular = float(np.mean(np.abs(intervals / period - 1) > .22))
    # Meter is reported only when model downbeats consistently agree. Do not
    # assume every song is 4/4, nor call the model's two-beat mistakes a meter.
    downbeat_indices = np.rint((downbeats - offset) / period).astype(int)
    spans = np.diff(downbeat_indices)
    spans = spans[spans > 0]
    if len(spans):
        values, counts = np.unique(spans, return_counts=True)
        which = int(np.argmax(counts)); proposed_meter = int(values[which]); meter_confidence = float(counts[which] / counts.sum())
        meter = proposed_meter if proposed_meter in [3, 4] and meter_confidence >= .75 else None
    else:
        meter, meter_confidence = None, 0.0
    return {"bpm": round(bpm, 3), "offset": round(offset, 6),
            "confidence": round(float(coherence * np.mean(weights) * (1 - min(.5, irregular))), 4),
            "quality": {"beatCount": len(times), "downbeatCount": len(downbeats), "meter": meter,
                        "meterConfidence": round(meter_confidence, 4), "beatConfidenceMean": round(float(np.mean(weights)), 4),
                        "irregularIntervalFraction": round(irregular, 4), "gridResidualMedianSeconds": round(float(np.median(residual)), 6)}}


def stem_events(signal, sample_rate, np):
    """Physical attacks in an already isolated drum estimate, not a beat grid."""
    from scipy.signal import find_peaks
    step = max(1, round(sample_rate * .002))
    width = max(2, round(sample_rate * .005))
    delay = max(1, round(.012 * sample_rate / step))
    # Prefix sums avoid a long convolution and preserve bounded memory.
    square = np.square(signal.astype(np.float64))
    prefix = np.r_[0.0, np.cumsum(square)]
    centers = np.arange(0, len(signal), step)
    left = np.maximum(0, centers - width // 2)
    right = np.minimum(len(signal), centers + (width + 1) // 2)
    energy = (prefix[right] - prefix[left]) / width
    rise = np.maximum(0, energy - np.r_[np.zeros(delay), energy[:-delay]])
    peak_value = float(np.max(rise)) if len(rise) else 0.0
    if peak_value < 1e-12:
        return [], []
    peaks, _ = find_peaks(rise, distance=max(1, round(.085 * sample_rate / step)), prominence=peak_value * .015)
    events = []
    for peak in peaks:
        edge = peak
        while edge > 0 and rise[edge - 1] > rise[peak] * .18:
            edge -= 1
        timestamp = edge * step / sample_rate
        start = max(0, round((timestamp - .005) * sample_rate))
        end = min(len(signal), round((timestamp + .05) * sample_rate))
        sample = signal[start:end]
        if len(sample) < 2:
            continue
        spectrum = np.abs(np.fft.rfft(sample * np.hanning(len(sample)))) ** 2
        frequencies = np.fft.rfftfreq(len(sample), 1 / sample_rate)
        bands = [float(spectrum[(frequencies >= lo) & (frequencies < hi)].sum()) for lo, hi in [(30, 250), (250, 2000), (2000, sample_rate / 2 + 1)]]
        total = sum(bands) or 1
        low, mid, high = [value / total for value in bands]
        strength = float(rise[peak] / peak_value)
        kind = "kick" if low > .6 else "hat" if high > .45 else "snare"
        events.append({"time": round(timestamp, 6), "strength": round(strength, 6), "kind": kind,
                       "confidence": round(.55 + .4 * math.sqrt(strength), 6),
                       "low": round(low, 6), "mid": round(mid, 6), "high": round(high, 6),
                       "percussiveRatio": 1, "source": "demucs-htdemucs"})
    # Group short waveform-energy windows into sustained activity regions.
    windows = []
    for start in range(0, len(signal), sample_rate):
        sample = signal[start:min(len(signal), start + sample_rate)]
        windows.append(float(np.sqrt(np.mean(sample ** 2))))
    maximum = max(windows) if windows else 0
    ranges = []
    for index, rms in enumerate(windows):
        if rms < max(1e-6, maximum * .025):
            continue
        end = min(len(signal) / sample_rate, index + 1)
        if ranges and ranges[-1]["end"] == index:
            ranges[-1]["end"] = end
        else:
            ranges.append({"start": index, "end": end})
    return events, ranges


def separate_drums(signal, sample_rate, args):
    """Run the pinned official htdemucs locally; never save or upload a stem."""
    import numpy as np
    import soxr
    import torch
    from demucs.apply import apply_model
    from demucs.states import load_model
    start = time.perf_counter()
    torch.set_num_threads(args.threads)
    # This known author checkpoint embeds its architecture. Verify its complete
    # digest before explicit pickle loading; no URL/model-name fallback exists.
    if not DRUM_CHECKPOINT.is_file() or digest(DRUM_CHECKPOINT) != DRUM_CHECKPOINT_SHA256:
        raise RuntimeError("The local drum separator is missing or damaged. Run npm run model:setup.")
    package = torch.load(DRUM_CHECKPOINT, map_location="cpu", weights_only=False)
    separator = load_model(package)
    separator.cpu().eval()
    separator_rate = int(separator.samplerate)
    mono = soxr.resample(signal, sample_rate, separator_rate) if sample_rate != separator_rate else signal
    waveform = torch.from_numpy(np.asarray(mono, dtype=np.float32).copy()).unsqueeze(0).repeat(int(separator.audio_channels), 1)
    reference = waveform.mean(0)
    average, deviation = reference.mean(), reference.std()
    if float(deviation) < 1e-7:
        return {"percussionSource": "demucs-htdemucs", "percussionMethod": "learned-drum-stem", "percussionEvents": [],
                "drumQuality": {"eventCount": 0, "activeRanges": [], "silent": True, "elapsedSeconds": 0}}
    waveform = (waveform - average) / deviation
    with torch.inference_mode():
        sources = apply_model(separator, waveform[None], device="cpu", shifts=0, split=True, overlap=.1, progress=False, num_workers=0)[0]
        drum_tensor = sources[separator.sources.index("drums")] * deviation + average
        drums = drum_tensor.mean(0).cpu().numpy()
    del sources, drum_tensor, waveform, separator, package
    drums = soxr.resample(drums, separator_rate, sample_rate) if separator_rate != sample_rate else drums
    drums = np.asarray(drums[:len(signal)], dtype=np.float32)
    events, active_ranges = stem_events(drums, sample_rate, np)
    return {"percussionSource": "demucs-htdemucs", "percussionMethod": "learned-drum-stem", "percussionEvents": events,
            "drumQuality": {"model": "htdemucs", "checkpointSha256": DRUM_CHECKPOINT_SHA256,
                            "device": "cpu", "inputSampleRate": sample_rate, "inputMono": True,
                            "separatorSampleRate": separator_rate, "eventCount": len(events), "activeRanges": active_ranges,
                            "onsetMethod": "waveform-energy-rise", "confidenceIsHeuristic": True,
                            "elapsedSeconds": round(time.perf_counter() - start, 3)}}


def analyze(signal, sr, args):
    import numpy as np
    import torch
    from beat_this.inference import Audio2Frames
    from beat_this.model.postprocessor import Postprocessor
    torch.set_num_threads(args.threads)
    start = time.perf_counter()
    duration = len(signal) / sr
    model = {"id": "beat-this-small0", "name": "Beat This! small0", "packageVersion": importlib.metadata.version("beat-this"),
             "checkpointSha256": digest(CHECKPOINT), "device": "cpu", "frameRate": FPS,
             "postprocessor": "official-minimal", "license": "MIT", "learned": True}
    if float(np.max(np.abs(signal))) < 1e-7:
        return {"schemaVersion": 1, "model": model, "duration": duration, "bpm": 120, "offset": 0, "confidence": 0,
                "beatTimes": [], "downbeatTimes": [], "beats": [],
                "activations": {"frameDuration": 1 / FPS, "beatProbabilities": [], "downbeatProbabilities": []},
                "quality": {"beatCount": 0, "downbeatCount": 0, "meter": None, "silent": True},
                "warnings": ["No audible signal was detected; no learned beats were emitted."], "elapsedSeconds": round(time.perf_counter() - start, 3)}
    # Use the author's preprocessing, overlapping inference chunks and peak
    # picker. Obtain logits once so the UI can inspect actual learned evidence.
    predictor = Audio2Frames(checkpoint_path=str(CHECKPOINT), device="cpu", float16=False)
    with torch.inference_mode():
        beat_logits, downbeat_logits = predictor(signal, sr)
        predicted_beats, predicted_downbeats = Postprocessor(type="minimal", fps=FPS)(beat_logits, downbeat_logits)
        beat_probability = beat_logits.sigmoid().cpu().numpy().reshape(-1)
        downbeat_probability = downbeat_logits.sigmoid().cpu().numpy().reshape(-1)
    times = np.asarray(predicted_beats, dtype=np.float64)
    times = times[(times >= 0) & (times < duration)]
    downbeats = np.asarray(predicted_downbeats, dtype=np.float64)
    downbeats = downbeats[(downbeats >= 0) & (downbeats < duration)]
    confidences = []
    events = []
    for value in times:
        index = min(len(beat_probability) - 1, max(0, round(float(value) * FPS)))
        confidence = float(beat_probability[index]); confidences.append(confidence)
        events.append({"time": round(float(value), 6), "confidence": round(confidence, 6),
                       "downbeatProbability": round(float(downbeat_probability[index]), 6),
                       "isDownbeat": bool(np.any(np.abs(downbeats - value) <= .011))})
    timing = timing_summary(times, confidences, downbeats, np)
    warnings = []
    if len(times) < 4:
        warnings.append("The model detected too few beats for a reliable rhythm map.")
    if timing["quality"]["meter"] is None:
        warnings.append("Downbeat/meter estimates are inconsistent; bar accents should be reviewed.")
    if timing["quality"].get("irregularIntervalFraction", 0) > .08:
        warnings.append("Beat intervals vary; this may reflect real tempo changes, missed beats or model errors.")
    if len(times) and duration - times[-1] > max(2.0, 3 * 60 / timing["bpm"]):
        warnings.append("No confident learned beats were detected near the end; the tail is left unfilled.")
    return {"schemaVersion": 1, "model": model, "duration": round(duration, 6), **timing,
            "beatTimes": [round(float(value), 6) for value in times],
            "downbeatTimes": [round(float(value), 6) for value in downbeats], "beats": events,
            "activations": {"frameDuration": 1 / FPS,
                            "beatProbabilities": np.round(beat_probability, 6).tolist(),
                            "downbeatProbabilities": np.round(downbeat_probability, 6).tolist()},
            "warnings": warnings, "elapsedSeconds": round(time.perf_counter() - start, 3)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="?", help="Local audio file; requires FFmpeg. Never uploaded.")
    parser.add_argument("--stdin-f32", action="store_true", help="Read mono little-endian float32 PCM from stdin.")
    parser.add_argument("--sample-rate", type=int, default=22050)
    parser.add_argument("--trim-start", type=float, default=0)
    parser.add_argument("--trim-end", type=float)
    parser.add_argument("--threads", type=int, default=min(4, os.cpu_count() or 1))
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--download", action="store_true", help="Explicitly download the official small0 weights during setup.")
    parser.add_argument("--separate-drums", action="store_true", help="Also run cached official htdemucs CPU separation; may take several minutes.")
    args = parser.parse_args()
    if args.status:
        emit(runtime_status()); return
    if args.download:
        information = download()
        if args.separate_drums:
            information["drumModel"] = download(DRUM_CHECKPOINT, DRUM_CHECKPOINT_URL, DRUM_CHECKPOINT_SHA256, 100 * 1024 * 1024)
        emit({**information, **runtime_status()}); return
    if not 1 <= args.threads <= 16:
        raise ValueError("CPU threads must be between 1 and 16.")
    if not math.isfinite(args.trim_start) or args.trim_start < 0:
        raise ValueError("Trim start must be a finite nonnegative time in seconds.")
    if args.trim_end is not None and (not math.isfinite(args.trim_end) or args.trim_end <= args.trim_start or args.trim_end - args.trim_start > MAX_DURATION):
        raise ValueError("Trim end must follow trim start and keep at most ten minutes of audio.")
    status = runtime_status()
    if not status["ready"]:
        raise RuntimeError("Local beat model is not installed. Run npm run model:setup, then restart the local bridge.")
    if args.separate_drums and not status["drumsReady"]:
        raise RuntimeError("The local drum separator is not installed. Run npm run model:setup, then restart the bridge.")
    # Some library versions print loader information; preserve the JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        signal, sample_rate = decode_audio(args, np)
        result = analyze(signal, sample_rate, args)
        if args.separate_drums:
            print("Separating drums with local htdemucs on CPU; this can take several minutes.", file=sys.stderr, flush=True)
            result.update(separate_drums(signal, sample_rate, args))
            result["elapsedSeconds"] = round(result["elapsedSeconds"] + result["drumQuality"]["elapsedSeconds"], 3)
    emit(result)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit({"error": str(error), "kind": type(error).__name__, "local": True})
        sys.exit(1)
