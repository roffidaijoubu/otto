#!/usr/bin/env python3
"""
Cut a clean raw .mp4 + time-shifted .srt clip from a YouTube VOD for human clippers/editors.
Zero AI video editing; downloads only the exact requested timestamp range via yt-dlp + ffmpeg.
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


def format_hhmmss(sec: int) -> str:
    sec = max(0, int(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def format_srt_ms(ms: int) -> str:
    ms = max(0, int(ms))
    total_s, millis = divmod(ms, 1000)
    h, rem = divmod(total_s, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d},{millis:03d}"


def safe_slug(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip().lower()).strip("_")
    return slug[:64] or "clip"


def write_sliced_srt(transcript_path: Path, start_sec: int, end_sec: int, srt_path: Path) -> int:
    data = json.loads(transcript_path.read_text(encoding="utf-8"))
    segs: list[dict[str, Any]] = data.get("segments") or []
    start_ms = start_sec * 1000
    end_ms = end_sec * 1000

    entries: list[str] = []
    idx = 1
    for seg in segs:
        s_ms = int(seg.get("start_ms", 0))
        e_ms = int(seg.get("end_ms", s_ms + 2000))
        if e_ms < start_ms or s_ms > end_ms:
            continue
        rel_s = max(0, s_ms - start_ms)
        rel_e = max(rel_s + 500, min(end_ms, e_ms) - start_ms)
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        entries.append(f"{idx}\n{format_srt_ms(rel_s)} --> {format_srt_ms(rel_e)}\n{text}\n")
        idx += 1

    srt_path.write_text("\n".join(entries), encoding="utf-8")
    return idx - 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Cut raw .mp4 + .srt clip from a YouTube VOD.")
    parser.add_argument("--url", required=True, help="YouTube VOD URL")
    parser.add_argument("--start-sec", type=int, required=True, help="Clip start time in seconds")
    parser.add_argument("--end-sec", type=int, required=True, help="Clip end time in seconds")
    parser.add_argument("--name", required=True, help="Clip filename slug (e.g. clip_01_plot_twist)")
    parser.add_argument("--out-dir", type=Path, required=True, help="Output directory")
    parser.add_argument("--transcript", type=Path, default=None, help="Optional <video_id>.transcript.json for .srt generation")
    args = parser.parse_args()

    if args.end_sec <= args.start_sec:
        print("end_sec must be greater than start_sec", file=sys.stderr)
        return 1
    if args.end_sec - args.start_sec > 300:
        print("Clip duration exceeds 300s safety limit; keep raw clips under 5 minutes.", file=sys.stderr)
        return 1

    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        print("yt-dlp not found in PATH", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    slug = safe_slug(args.name)
    mp4_path = args.out_dir / f"{slug}.mp4"
    srt_path = args.out_dir / f"{slug}.srt"

    section = f"*{format_hhmmss(args.start_sec)}-{format_hhmmss(args.end_sec)}"
    cmd = [
        yt_dlp,
        "--no-update",
        "--download-sections", section,
        "--force-keyframes-at-cuts",
        "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
        "--merge-output-format", "mp4",
        "--force-overwrites",
        "-o", str(mp4_path),
        args.url,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not mp4_path.exists():
        print(res.stderr or res.stdout or "yt-dlp failed to cut clip", file=sys.stderr)
        return 1

    srt_lines = 0
    if args.transcript and args.transcript.exists():
        srt_lines = write_sliced_srt(args.transcript, args.start_sec, args.end_sec, srt_path)

    print(json.dumps({
        "mp4_path": str(mp4_path),
        "mp4_bytes": mp4_path.stat().st_size,
        "srt_path": str(srt_path) if srt_lines > 0 else None,
        "srt_entries": srt_lines,
        "start_sec": args.start_sec,
        "end_sec": args.end_sec,
        "start_str": format_hhmmss(args.start_sec),
        "end_str": format_hhmmss(args.end_sec),
        "duration_sec": args.end_sec - args.start_sec,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
