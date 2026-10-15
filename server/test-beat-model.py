"""Fast structural tests; real-song inference evidence stays in ignored .local-tests/."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

import numpy as np

SCRIPT = Path(__file__).with_name("beat-model.py")
spec = importlib.util.spec_from_file_location("beat_model", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BeatModelTests(unittest.TestCase):
    def test_precision_grid_summary_does_not_replace_or_mutate_predictions(self):
        # Quantized neural timestamps contain misses and a half-beat mistake.
        period = 60 / 88
        times = np.round((.25 + np.arange(200) * period) * 50) / 50
        times = np.delete(times, [25, 85, 120])
        times = np.sort(np.append(times, 23.25))
        original = times.copy()
        result = module.timing_summary(times, np.full(len(times), .9), np.array([]), np)
        self.assertLess(abs(result["bpm"] - 88), .01)
        self.assertLess(abs(result["offset"] - .25), .01)
        self.assertEqual(result["quality"]["beatCount"], len(times))
        np.testing.assert_array_equal(times, original)

    def test_ambiguous_two_beat_downbeats_are_not_claimed_as_four_four(self):
        times = .25 + np.arange(40) * .68
        result = module.timing_summary(times, np.ones(len(times)), times[::2], np)
        self.assertIsNone(result["quality"]["meter"])
        consistent = module.timing_summary(times, np.ones(len(times)), times[::4], np)
        self.assertEqual(consistent["quality"]["meter"], 4)

    def test_too_few_learned_beats_have_zero_timing_confidence(self):
        result = module.timing_summary(np.array([.2, 1.0]), [.8, .9], np.array([]), np)
        self.assertEqual(result["confidence"], 0)
        self.assertEqual(result["quality"]["beatCount"], 2)

    def test_status_is_one_json_document_without_inference(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--status"], capture_output=True, text=True, check=True)
        status = json.loads(run.stdout)
        self.assertEqual(status["model"], "beat-this-small0")
        self.assertEqual(status["device"], "cpu")
        self.assertIn("ready", status)

    def test_invalid_trim_returns_actionable_json(self):
        run = subprocess.run([sys.executable, str(SCRIPT), "--stdin-f32", "--trim-start", "nan"], input=b"", capture_output=True)
        self.assertEqual(run.returncode, 1)
        self.assertIn("Trim start", json.loads(run.stdout)["error"])

    def test_stem_attacks_preserve_syncopation_without_metronome_filling(self):
        sample_rate = 22050
        signal = np.zeros(sample_rate * 8, dtype=np.float32)
        # A drum-only fixture: silence, then a sparse dembow pattern.
        expected = [2.0, 2.0 + .75 * .68, 2.68, 2.0 + 1.5 * .68, 3.36]
        for timestamp in expected:
            start = round(timestamp * sample_rate)
            t = np.arange(1200) / sample_rate
            signal[start:start + len(t)] += (np.sin(2 * np.pi * 130 * t) * np.exp(-t / .015)).astype(np.float32)
        events, ranges = module.stem_events(signal, sample_rate, np)
        self.assertEqual(len(events), len(expected))
        for event, timestamp in zip(events, expected):
            self.assertLess(abs(event["time"] - timestamp), .012)
            self.assertEqual(event["source"], "demucs-htdemucs")
            self.assertGreaterEqual(event["confidence"], .4)
        self.assertGreaterEqual(ranges[0]["start"], 2)
        self.assertEqual(module.stem_events(np.zeros(sample_rate), sample_rate, np), ([], []))

    def test_quiet_high_hats_are_detected_beside_louder_kicks(self):
        sr=22050
        audio=np.zeros(sr*7,dtype=np.float32)
        hats=[]
        rng=np.random.default_rng(42)
        for beat in np.arange(1,6,.5):
            t=np.arange(3000)/sr
            start=round(beat*sr)
            audio[start:start+len(t)]+=.8*np.sin(2*np.pi*80*t)*np.exp(-t*25)
            time=beat+.25
            hats.append(time)
            t=np.arange(800)/sr
            noise=rng.normal(size=len(t))
            noise=np.r_[0.,np.diff(noise)]
            start=round(time*sr)
            audio[start:start+len(t)]+=.025*noise*np.exp(-t*130)
        events,_=module.stem_events(audio,sr,np)
        found=[time for time in hats if any(event.get('detail') and abs(event['time']-time)<.02 for event in events)]
        self.assertGreaterEqual(len(found),len(hats)*.9)


if __name__ == "__main__":
    unittest.main()
