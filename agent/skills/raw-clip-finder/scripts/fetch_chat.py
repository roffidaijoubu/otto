#!/usr/bin/env python3
"""
PoC script to fetch and normalize YouTube livestream chat replay into clean JSON.

Usage:
    python fetch_chat.py "https://www.youtube.com/watch?v=u_Lb6sh9N0M"
    python fetch_chat.py "https://www.youtube.com/watch?v=u_Lb6sh9N0M" --out-dir ./output --keep-raw
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any


def format_ms(ms: int) -> str:
    """Format milliseconds into HH:MM:SS (supports negative pre-stream offsets)."""
    sign = "-" if ms < 0 else ""
    total_seconds = abs(ms) // 1000
    hours, rem = divmod(total_seconds, 3600)
    minutes, seconds = divmod(rem, 60)
    return f"{sign}{hours:02d}:{minutes:02d}:{seconds:02d}"


def extract_runs_text(runs: list[dict[str, Any]] | None) -> str:
    """Flatten YouTube text/emoji runs into a readable string."""
    if not runs:
        return ""
    parts: list[str] = []
    for run in runs:
        if "text" in run:
            parts.append(run["text"])
        elif "emoji" in run:
            emoji = run["emoji"]
            shortcuts = emoji.get("shortcuts") or []
            if shortcuts:
                parts.append(shortcuts[0])
            elif emoji.get("emojiId"):
                parts.append(emoji["emojiId"])
    return "".join(parts).strip()


def extract_badges(renderer: dict[str, Any]) -> list[str]:
    """Extract author badge labels (e.g., Moderator, Member, Owner)."""
    badges: list[str] = []
    for badge in renderer.get("authorBadges") or []:
        b = badge.get("liveChatAuthorBadgeRenderer") or {}
        tooltip = b.get("tooltip")
        if tooltip:
            badges.append(tooltip)
    return badges


def parse_chat_item(action: dict[str, Any], video_offset_ms: int) -> dict[str, Any] | None:
    """Parse a single addChatItemAction into a normalized message dict."""
    item = (action.get("addChatItemAction") or {}).get("item") or {}
    if not item:
        return None

    msg_type = "other"
    renderer: dict[str, Any] | None = None
    amount: str | None = None
    message_text = ""

    if "liveChatTextMessageRenderer" in item:
        msg_type = "text"
        renderer = item["liveChatTextMessageRenderer"]
        message_text = extract_runs_text((renderer.get("message") or {}).get("runs"))
    elif "liveChatPaidMessageRenderer" in item:
        msg_type = "superchat"
        renderer = item["liveChatPaidMessageRenderer"]
        amount = (renderer.get("purchaseAmountText") or {}).get("simpleText")
        message_text = extract_runs_text((renderer.get("message") or {}).get("runs"))
    elif "liveChatPaidStickerRenderer" in item:
        msg_type = "supersticker"
        renderer = item["liveChatPaidStickerRenderer"]
        amount = (renderer.get("purchaseAmountText") or {}).get("simpleText")
        message_text = (
            ((renderer.get("sticker") or {}).get("accessibility") or {})
            .get("accessibilityData", {})
            .get("label", "[Sticker]")
        )
    elif "liveChatMembershipItemRenderer" in item:
        msg_type = "membership"
        renderer = item["liveChatMembershipItemRenderer"]
        header = extract_runs_text((renderer.get("headerSubtext") or {}).get("runs"))
        body = extract_runs_text((renderer.get("message") or {}).get("runs"))
        message_text = " - ".join(part for part in (header, body) if part)
    else:
        return None

    if not renderer:
        return None

    author_name = (renderer.get("authorName") or {}).get("simpleText", "")
    author_channel_id = renderer.get("authorExternalChannelId", "")
    timestamp_usec = renderer.get("timestampUsec")

    entry: dict[str, Any] = {
        "id": renderer.get("id", ""),
        "timestamp_ms": video_offset_ms,
        "timestamp_str": format_ms(video_offset_ms),
        "published_at_usec": int(timestamp_usec) if timestamp_usec else None,
        "type": msg_type,
        "author": author_name,
        "author_channel_id": author_channel_id,
        "badges": extract_badges(renderer),
        "message": message_text,
    }
    if amount is not None:
        entry["amount"] = amount
    return entry


def parse_raw_live_chat(raw_path: Path) -> list[dict[str, Any]]:
    """Parse yt-dlp's NDJSON .live_chat.json into a list of normalized chat messages."""
    messages: list[dict[str, Any]] = []
    with raw_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue

            replay_action = payload.get("replayChatItemAction") or {}
            offset_raw = replay_action.get("videoOffsetTimeMsec")
            video_offset_ms = int(offset_raw) if offset_raw is not None else 0

            for action in replay_action.get("actions") or []:
                parsed = parse_chat_item(action, video_offset_ms)
                if parsed:
                    messages.append(parsed)

    messages.sort(key=lambda m: m["timestamp_ms"])
    return messages


def compute_stats(messages: list[dict[str, Any]], bucket_seconds: int = 60) -> dict[str, Any]:
    """Compute summary statistics and top chat activity windows."""
    type_counts = Counter(m["type"] for m in messages)
    unique_authors = len({m["author_channel_id"] or m["author"] for m in messages})

    bucket_counts: Counter[int] = Counter()
    for m in messages:
        if m["timestamp_ms"] >= 0:
            bucket = (m["timestamp_ms"] // 1000) // bucket_seconds
            bucket_counts[bucket] += 1

    top_windows = [
        {
            "start_str": format_ms(bucket * bucket_seconds * 1000),
            "end_str": format_ms((bucket + 1) * bucket_seconds * 1000),
            "message_count": count,
        }
        for bucket, count in bucket_counts.most_common(5)
    ]

    return {
        "total_messages": len(messages),
        "unique_authors": unique_authors,
        "counts_by_type": dict(type_counts),
        "top_activity_windows_60s": top_windows,
    }


def download_live_chat(url: str, out_dir: Path) -> tuple[Path, Path | None]:
    """Invoke yt-dlp to download live_chat subtitle NDJSON and video info JSON."""
    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        raise RuntimeError("yt-dlp not found in PATH. Please install yt-dlp first.")

    out_dir.mkdir(parents=True, exist_ok=True)
    output_template = str(out_dir / "%(id)s.%(ext)s")

    cmd = [
        yt_dlp,
        "--skip-download",
        "--write-subs",
        "--sub-langs",
        "live_chat",
        "--write-info-json",
        "--no-update",
        "--output",
        output_template,
    ]
    if shutil.which("node"):
        cmd.extend(["--js-runtimes", "node"])
    cmd.append(url)

    print(f"[fetch_chat] Running yt-dlp for: {url}", flush=True)
    result = subprocess.run(cmd)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed (exit {result.returncode})")

    # Locate the newly written .live_chat.json file
    raw_files = sorted(
        out_dir.glob("*.live_chat.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not raw_files:
        raise RuntimeError(
            "No .live_chat.json was downloaded. This video may not have live chat replay available."
        )

    raw_chat_path = raw_files[0]
    video_id = raw_chat_path.name.removesuffix(".live_chat.json")
    info_path = out_dir / f"{video_id}.info.json"
    return raw_chat_path, info_path if info_path.exists() else None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch YouTube livestream chat replay and save as normalized JSON."
    )
    parser.add_argument("url", nargs="?", help="YouTube livestream / VOD URL")
    parser.add_argument(
        "--from-raw",
        type=Path,
        default=None,
        help="Parse an existing yt-dlp .live_chat.json (or .part) file without downloading",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "output",
        help="Directory to store output JSON files (default: poc/chatlog/output)",
    )
    parser.add_argument(
        "--keep-raw",
        action="store_true",
        help="Keep intermediate yt-dlp .live_chat.json and .info.json files",
    )
    args = parser.parse_args()

    if not args.from_raw and not args.url:
        parser.error("Provide either a YouTube URL or --from-raw <path>.")

    if args.from_raw:
        raw_chat_path = args.from_raw.resolve()
        if not raw_chat_path.exists():
            print(f"[error] Raw file not found: {raw_chat_path}", file=sys.stderr)
            return 1
        args.out_dir.mkdir(parents=True, exist_ok=True)
        video_id = raw_chat_path.name.split(".")[0]
        candidate_info = raw_chat_path.parent / f"{video_id}.info.json"
        info_path = candidate_info if candidate_info.exists() else None
    else:
        try:
            raw_chat_path, info_path = download_live_chat(args.url, args.out_dir)
        except Exception as exc:
            print(f"[error] {exc}", file=sys.stderr)
            return 1
        video_id = raw_chat_path.name.removesuffix(".live_chat.json")

    metadata: dict[str, Any] = {
        "video_id": video_id,
        "url": args.url or f"https://www.youtube.com/watch?v={video_id}",
        "is_partial": raw_chat_path.name.endswith(".part"),
    }

    if info_path and info_path.exists():
        try:
            info = json.loads(info_path.read_text(encoding="utf-8"))
            metadata.update(
                {
                    "title": info.get("title"),
                    "channel": info.get("channel") or info.get("uploader"),
                    "channel_id": info.get("channel_id"),
                    "duration_sec": info.get("duration"),
                    "upload_date": info.get("upload_date"),
                    "was_live": info.get("was_live"),
                }
            )
        except json.JSONDecodeError:
            pass

    print(f"[fetch_chat] Parsing raw chat log: {raw_chat_path.name}", flush=True)
    messages = parse_raw_live_chat(raw_chat_path)
    stats = compute_stats(messages)

    output_data = {
        "metadata": metadata,
        "stats": stats,
        "messages": messages,
    }

    clean_path = args.out_dir / f"{video_id}.chat.json"
    clean_path.write_text(
        json.dumps(output_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    if not args.from_raw and not args.keep_raw:
        raw_chat_path.unlink(missing_ok=True)
        if info_path:
            info_path.unlink(missing_ok=True)

    print(f"[done] Saved normalized chatlog to: {clean_path}")
    print(f"       Title          : {metadata.get('title', 'N/A')}")
    print(f"       Total messages : {stats['total_messages']}")
    print(f"       Unique authors : {stats['unique_authors']}")
    print(f"       Types          : {stats['counts_by_type']}")
    if stats["top_activity_windows_60s"]:
        print("       Top 60s spikes :")
        for w in stats["top_activity_windows_60s"]:
            print(f"         - {w['start_str']} - {w['end_str']}: {w['message_count']} msgs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
