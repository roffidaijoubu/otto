#!/usr/bin/env python3
"""
Download YouTube auto-generated transcript (json3) via yt-dlp and normalize it
into clean timestamped segments for hype moment analysis.

Usage:
    python fetch_transcript.py "https://www.youtube.com/watch?v=03qhcshfeMY"
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


def format_ms(ms: int) -> str:
    sign = "-" if ms < 0 else ""
    total_seconds = abs(ms) // 1000
    hours, rem = divmod(total_seconds, 3600)
    minutes, seconds = divmod(rem, 60)
    return f"{sign}{hours:02d}:{minutes:02d}:{seconds:02d}"


def extract_video_id(url_or_id: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", url_or_id):
        return url_or_id
    parsed = urlparse(url_or_id)
    if parsed.hostname in ("youtu.be", "www.youtu.be"):
        return parsed.path.lstrip("/").split("/")[0]
    qs = parse_qs(parsed.query)
    if "v" in qs and qs["v"]:
        return qs["v"][0]
    m = re.search(r"/(?:live|shorts|embed)/([A-Za-z0-9_-]{11})", parsed.path)
    if m:
        return m.group(1)
    raise ValueError(f"Could not extract YouTube video ID from: {url_or_id}")


def parse_json3(raw_path: Path) -> list[dict[str, Any]]:
    """Parse YouTube json3 subtitle file into clean timestamped caption segments."""
    data = json.loads(raw_path.read_text(encoding="utf-8"))
    segments: list[dict[str, Any]] = []

    for ev in data.get("events") or []:
        segs = ev.get("segs")
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            continue

        start_ms = int(ev.get("tStartMs", 0))
        dur_ms = int(ev.get("dDurationMs", 0))
        segments.append(
            {
                "start_ms": start_ms,
                "end_ms": start_ms + dur_ms,
                "start_str": format_ms(start_ms),
                "text": text,
            }
        )

    segments.sort(key=lambda s: s["start_ms"])
    return segments


def download_transcript(
    url: str,
    out_dir: Path,
    langs: str = "id-orig,id,en-orig,en",
    keep_raw: bool = False,
) -> Path:
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        raise RuntimeError("yt-dlp not found in PATH.")

    video_id = extract_video_id(url)
    out_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(out_dir / "%(id)s.%(ext)s")

    # Try preferred languages one-by-one so we only download 1 best track
    raw_json3: Path | None = None
    picked_lang: str | None = None
    for lang in [l.strip() for l in langs.split(",") if l.strip()]:
        cmd = [
            yt_dlp,
            "--no-update",
            "--skip-download",
            "--write-auto-subs",
            "--sub-langs",
            lang,
            "--sub-format",
            "json3",
            "--output",
            output_template,
            url,
        ]
        subprocess.run(cmd, check=False)
        candidate = out_dir / f"{video_id}.{lang}.json3"
        if candidate.exists():
            raw_json3 = candidate
            picked_lang = lang
            break

    if not raw_json3:
        raise RuntimeError(
            f"No auto-transcript json3 found for {video_id} (tried langs: {langs})."
        )

    segments = parse_json3(raw_json3)
    output_data = {
        "metadata": {
            "video_id": video_id,
            "url": url,
            "language": picked_lang,
            "segment_count": len(segments),
        },
        "segments": segments,
    }

    clean_path = out_dir / f"{video_id}.transcript.json"
    clean_path.write_text(
        json.dumps(output_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if not keep_raw:
        raw_json3.unlink(missing_ok=True)

    print(
        f"[transcript] Saved {len(segments)} segments ({picked_lang}) to: {clean_path}",
        flush=True,
    )
    return clean_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch YouTube auto-transcript (json3) and save normalized JSON."
    )
    parser.add_argument("url", help="YouTube video URL or 11-char ID")
    parser.add_argument(
        "--langs",
        default="id-orig,id,en-orig,en",
        help="Comma-separated language preference order (default: id-orig,id,en-orig,en)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "output",
        help="Output directory (default: poc/hype/output)",
    )
    parser.add_argument("--keep-raw", action="store_true", help="Keep raw .json3 file")
    args = parser.parse_args()

    try:
        download_transcript(args.url, args.out_dir, langs=args.langs, keep_raw=args.keep_raw)
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
