"""Offline stdlib unittest suite for Stage 1 deterministic VOD Hype Detector."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

SCRIPT_PATH = (
    Path(__file__).resolve().parent.parent
    / "agent"
    / "skills"
    / "raw-clip-finder"
    / "scripts"
    / "detect_hype_candidates.py"
)

spec = importlib.util.spec_from_file_location("detect_hype_candidates", SCRIPT_PATH)
assert spec is not None and spec.loader is not None
hype = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hype)


class HypeDetectorTests(unittest.TestCase):
    def test_format_sec(self) -> None:
        self.assertEqual(hype.format_sec(0), "00:00:00")
        self.assertEqual(hype.format_sec(65), "00:01:05")
        self.assertEqual(hype.format_sec(3661), "01:01:01")
        self.assertEqual(hype.format_sec(-12), "00:00:00")

    def test_rolling_zscores_flat_and_spike(self) -> None:
        flat = hype.rolling_zscores([2.0] * 10, half_window=3)
        self.assertTrue(all(z == 0.0 for z in flat))

        series = [1.0] * 10 + [25.0] + [1.0] * 10
        zs = hype.rolling_zscores(series, half_window=5)
        self.assertGreater(zs[10], 2.5)
        self.assertLess(zs[0], 0.5)

    def test_is_reaction_message_bilingual(self) -> None:
        self.assertTrue(hype.is_reaction_message("wkwkwkwk ngakak parah"))
        self.assertTrue(hype.is_reaction_message("NO WAY CLUTCH"))
        self.assertTrue(hype.is_reaction_message("W"))
        self.assertTrue(hype.is_reaction_message("😭😭😭"))
        self.assertTrue(hype.is_reaction_message("WAIT WHAT HAPPENED"))
        self.assertFalse(hype.is_reaction_message("hello everyone, good evening"))
        self.assertFalse(hype.is_reaction_message(""))

    def test_detect_candidates_finds_multi_author_burst_with_preroll_and_postroll(self) -> None:
        messages = []
        # Steady background chatter across 30 minutes (1800s)
        for sec in range(0, 1800, 10):
            messages.append(
                {
                    "timestamp_ms": sec * 1000,
                    "author": f"viewer_{sec % 20}",
                    "message": "nice stream tonight",
                }
            )
        # Clear hype burst around t = 600s (10:00) from 12 distinct viewers
        for i in range(12):
            messages.append(
                {
                    "timestamp_ms": (600 + (i % 5)) * 1000,
                    "author": f"hyped_{i}",
                    "message": "WKWKWK NO WAY :pog: :pog: 😂",
                }
            )

        candidates = hype.detect_candidates(
            messages,
            duration_sec=1800,
            bucket_sec=10,
            baseline_sec=300,
            pre_roll_sec=60,
            post_roll_sec=45,
            min_authors=3,
        )
        self.assertGreaterEqual(len(candidates), 1)
        top = candidates[0]
        # Peak around 600s -> pre_roll 60s gives window_start_sec <= 545s, post_roll 45s gives window_end_sec >= 645s
        self.assertLessEqual(top["window_start_sec"], 545)
        self.assertGreaterEqual(top["window_end_sec"], 645)
        self.assertGreater(top["composite_score"], 1.5)

    def test_detect_candidates_ignores_single_author_spam_and_intro_outro(self) -> None:
        messages = []
        for sec in range(0, 1200, 10):
            messages.append({"timestamp_ms": sec * 1000, "author": f"bg_{sec % 15}", "message": "chill"})
        # Single spammer burst at t = 400s (should be rejected by min_authors=4)
        for i in range(20):
            messages.append({"timestamp_ms": (400 + (i % 4)) * 1000, "author": "lone_spammer", "message": "WKWKWK OMG"})
        # Multi-author burst in intro deadzone (t = 20s < skip_intro_sec=90)
        for i in range(10):
            messages.append({"timestamp_ms": 20_000, "author": f"intro_{i}", "message": "HELLO WKWKWK"})

        candidates = hype.detect_candidates(
            messages,
            duration_sec=1200,
            min_authors=4,
            skip_intro_sec=90,
            skip_outro_sec=90,
        )
        self.assertEqual(candidates, [])


if __name__ == "__main__":
    unittest.main()
