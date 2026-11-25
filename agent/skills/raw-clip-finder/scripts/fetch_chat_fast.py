#!/usr/bin/env python3
"""
PoC v2: Fast parallel YouTube livestream chat replay extractor using
YouTube's InnerTube API (get_live_chat_replay + playerSeekContinuationData).

Splits the VOD timeline into chunks and fetches them concurrently with
ThreadPoolExecutor, then merges and deduplicates messages by ID.
Zero third-party dependencies (Python 3 standard library only).

Usage:
    python fetch_chat_fast.py "https://www.youtube.com/watch?v=u_Lb6sh9N0M"
    python fetch_chat_fast.py "https://www.youtube.com/watch?v=u_Lb6sh9N0M" --workers 12 --mode live
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

# Reuse normalization & stats helpers from PoC v1
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_chat import compute_stats, format_ms, parse_chat_item  # noqa: E402

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


def extract_video_id(url_or_id: str) -> str:
    """Extract 11-char YouTube video ID from URL or return as-is if already an ID."""
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


def http_request(
    url: str,
    payload: dict[str, Any] | None = None,
    timeout: int = 30,
    retries: int = 4,
) -> str:
    """Perform HTTP GET/POST with gzip decoding and exponential backoff retry."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "User-Agent": USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip",
    }
    if data is not None:
        headers["Content-Type"] = "application/json"

    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                if resp.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                return raw.decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(1.5 * (2**attempt))
                continue
            raise
        except Exception as e:
            last_err = e
            time.sleep(1.0 * (2**attempt))
    raise RuntimeError(f"HTTP request failed after {retries} retries: {last_err}")


def find_key(obj: Any, target_key: str) -> Any:
    """Depth-first search for a dict key inside nested JSON."""
    if isinstance(obj, dict):
        if target_key in obj:
            return obj[target_key]
        for v in obj.values():
            found = find_key(v, target_key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = find_key(v, target_key)
            if found is not None:
                return found
    return None


def bootstrap_session(video_id: str, mode: str = "live") -> dict[str, Any]:
    """Fetch watch page, extract InnerTube config, video metadata, and seek token."""
    watch_url = f"https://www.youtube.com/watch?v={video_id}"
    html = http_request(watch_url)

    api_key_m = re.search(r'"INNERTUBE_API_KEY":"([^"]+)"', html)
    client_ver_m = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html)
    if not api_key_m or not client_ver_m:
        raise RuntimeError("Failed to extract INNERTUBE_API_KEY or CLIENT_VERSION from watch page.")

    api_key = api_key_m.group(1)
    client_ver = client_ver_m.group(1)
    context = {
        "client": {
            "clientName": "WEB",
            "clientVersion": client_ver,
            "hl": "en",
            "gl": "US",
        }
    }

    # Extract video metadata from ytInitialPlayerResponse
    player_m = re.search(r"var ytInitialPlayerResponse = (\{.*?\});", html)
    video_details: dict[str, Any] = {}
    if player_m:
        try:
            video_details = json.loads(player_m.group(1)).get("videoDetails") or {}
        except json.JSONDecodeError:
            pass

    length_sec = int(video_details.get("lengthSeconds") or 0)
    if not length_sec:
        len_m = re.search(r'"lengthSeconds":"(\d+)"', html)
        length_sec = int(len_m.group(1)) if len_m else 0

    # Extract initial liveChatRenderer continuation from ytInitialData
    init_m = re.search(r"var ytInitialData = (\{.*?\});</script>", html)
    if not init_m:
        raise RuntimeError("Failed to find ytInitialData in watch page.")
    init_data = json.loads(init_m.group(1))

    lcr = find_key(init_data, "liveChatRenderer")
    if not lcr:
        raise RuntimeError("No liveChatRenderer found. Video may not have live chat replay.")

    initial_cont = lcr["continuations"][0]["reloadContinuationData"]["continuation"]
    endpoint = f"https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay?key={api_key}"

    # Fetch first page to discover mode switch menu (Top chat vs Live chat) and seek token
    first_resp = json.loads(
        http_request(endpoint, {"context": context, "continuation": initial_cont})
    )
    cc = (first_resp.get("continuationContents") or {}).get("liveChatContinuation") or {}

    selected_cont = initial_cont
    sub_items = find_key(cc.get("header") or {}, "subMenuItems") or []
    wanted = "Live chat" if mode == "live" else "Top chat"
    for item in sub_items:
        title = item.get("title") or ""
        if wanted.lower() in title.lower():
            cont_candidate = (
                (item.get("continuation") or {})
                .get("reloadContinuationData", {})
                .get("continuation")
            )
            if cont_candidate:
                selected_cont = cont_candidate
                break

    if selected_cont != initial_cont:
        first_resp = json.loads(
            http_request(endpoint, {"context": context, "continuation": selected_cont})
        )
        cc = (first_resp.get("continuationContents") or {}).get("liveChatContinuation") or {}

    seek_cont = None
    for c in cc.get("continuations") or []:
        if "playerSeekContinuationData" in c:
            seek_cont = c["playerSeekContinuationData"]["continuation"]
            break

    if not seek_cont:
        raise RuntimeError("No playerSeekContinuationData found; parallel seek not available.")

    metadata = {
        "video_id": video_id,
        "url": watch_url,
        "title": video_details.get("title"),
        "channel": video_details.get("author"),
        "channel_id": video_details.get("channelId"),
        "duration_sec": length_sec,
        "chat_mode": mode,
    }

    return {
        "endpoint": endpoint,
        "context": context,
        "initial_cont": selected_cont,
        "seek_cont": seek_cont,
        "duration_ms": length_sec * 1000,
        "metadata": metadata,
    }


def fetch_chunk(
    chunk_idx: int,
    start_ms: int,
    end_ms: int,
    session: dict[str, Any],
    overlap_ms: int = 5000,
) -> tuple[int, list[dict[str, Any]], int]:
    """Fetch all chat messages within [start_ms, end_ms] using InnerTube seek + continuation."""
    endpoint = session["endpoint"]
    context = session["context"]
    messages: list[dict[str, Any]] = []
    requests_made = 0

    # Start at chunk boundary via playerSeekContinuationData (or initial_cont for t=0)
    if start_ms == 0:
        payload: dict[str, Any] = {
            "context": context,
            "continuation": session["initial_cont"],
        }
    else:
        payload = {
            "context": context,
            "continuation": session["seek_cont"],
            "currentPlayerState": {"playerOffsetMs": str(start_ms)},
        }

    stop_threshold_ms = end_ms + overlap_ms
    seen_conts: set[str] = set()
    empty_pages = 0

    while True:
        resp = json.loads(http_request(endpoint, payload))
        requests_made += 1

        cc = (resp.get("continuationContents") or {}).get("liveChatContinuation") or {}
        actions = cc.get("actions") or []

        max_offset_in_page: int | None = None
        for act in actions:
            replay_action = act.get("replayChatItemAction") or {}
            offset_raw = replay_action.get("videoOffsetTimeMsec")
            if offset_raw is None:
                continue
            video_offset_ms = int(offset_raw)
            if max_offset_in_page is None or video_offset_ms > max_offset_in_page:
                max_offset_in_page = video_offset_ms

            if video_offset_ms > stop_threshold_ms:
                continue
            if start_ms > 0 and video_offset_ms < start_ms - overlap_ms:
                continue

            for sub_action in replay_action.get("actions") or []:
                parsed = parse_chat_item(sub_action, video_offset_ms)
                if parsed:
                    messages.append(parsed)

        if max_offset_in_page is not None and max_offset_in_page >= stop_threshold_ms:
            break

        if not actions:
            empty_pages += 1
            if empty_pages >= 5:
                break
        else:
            empty_pages = 0

        next_cont = None
        for c in cc.get("continuations") or []:
            if "liveChatReplayContinuationData" in c:
                next_cont = c["liveChatReplayContinuationData"]["continuation"]
                break

        if not next_cont or next_cont in seen_conts:
            break
        seen_conts.add(next_cont)
        payload = {"context": context, "continuation": next_cont}

    return chunk_idx, messages, requests_made


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fast parallel YouTube livestream chat replay fetcher via InnerTube API."
    )
    parser.add_argument("url", help="YouTube livestream / VOD URL or 11-char video ID")
    parser.add_argument(
        "--workers",
        type=int,
        default=12,
        help="Number of concurrent InnerTube workers (default: 12)",
    )
    parser.add_argument(
        "--chunks",
        type=int,
        default=0,
        help="Number of timeline chunks (default: auto, ~10 min per chunk)",
    )
    parser.add_argument(
        "--mode",
        choices=("live", "top"),
        default="live",
        help="Chat replay mode: 'live' (all messages) or 'top' (filtered). Default: live",
    )
    parser.add_argument(
        "--start-sec",
        type=int,
        default=0,
        help="Optional start offset in seconds (default: 0)",
    )
    parser.add_argument(
        "--end-sec",
        type=int,
        default=0,
        help="Optional end offset in seconds (default: full video duration)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "output",
        help="Output directory (default: poc/chatlog/output)",
    )
    args = parser.parse_args()

    t0 = time.perf_counter()
    try:
        video_id = extract_video_id(args.url)
        print(f"[fast] Bootstrapping InnerTube session for {video_id} (mode={args.mode})...", flush=True)
        session = bootstrap_session(video_id, mode=args.mode)
    except Exception as exc:
        print(f"[error] {exc}", file=sys.stderr)
        return 1

    duration_ms = session["duration_ms"]
    start_ms = max(0, args.start_sec * 1000)
    end_ms = args.end_sec * 1000 if args.end_sec > 0 else duration_ms
    if end_ms <= start_ms:
        print(f"[error] Invalid time range: {start_ms}ms .. {end_ms}ms", file=sys.stderr)
        return 1

    span_ms = end_ms - start_ms
    num_chunks = args.chunks if args.chunks > 0 else max(args.workers, min(32, max(1, span_ms // 600_000)))
    chunk_size_ms = (span_ms + num_chunks - 1) // num_chunks

    ranges: list[tuple[int, int, int]] = []
    for i in range(num_chunks):
        c_start = start_ms + i * chunk_size_ms
        c_end = min(end_ms, c_start + chunk_size_ms)
        if c_start < end_ms:
            ranges.append((i, c_start, c_end))

    meta = session["metadata"]
    print(
        f"[fast] Title: {meta.get('title')} | Duration: {format_ms(duration_ms)} | "
        f"Range: {format_ms(start_ms)}-{format_ms(end_ms)}",
        flush=True,
    )
    print(
        f"[fast] Launching {len(ranges)} chunks across {args.workers} parallel workers...",
        flush=True,
    )

    all_messages: list[dict[str, Any]] = []
    total_requests = 0
    completed = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(fetch_chunk, idx, c_start, c_end, session): (idx, c_start, c_end)
            for idx, c_start, c_end in ranges
        }
        for fut in as_completed(futures):
            idx, c_start, c_end = futures[fut]
            _, chunk_msgs, reqs = fut.result()
            all_messages.extend(chunk_msgs)
            total_requests += reqs
            completed += 1
            print(
                f"  [{completed:2d}/{len(ranges)}] Chunk {idx:02d} "
                f"({format_ms(c_start)}-{format_ms(c_end)}): "
                f"{len(chunk_msgs):5d} msgs ({reqs} reqs)",
                flush=True,
            )

    # Deduplicate overlapping boundary messages by message ID
    deduped: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for m in all_messages:
        mid = m.get("id")
        if mid:
            if mid in seen_ids:
                continue
            seen_ids.add(mid)
        deduped.append(m)

    deduped.sort(key=lambda m: (m["timestamp_ms"], m.get("published_at_usec") or 0))
    elapsed = time.perf_counter() - t0
    stats = compute_stats(deduped)

    meta["fetch_elapsed_sec"] = round(elapsed, 2)
    meta["workers"] = args.workers
    meta["chunks"] = len(ranges)
    meta["total_innertube_requests"] = total_requests
    meta["range_start_str"] = format_ms(start_ms)
    meta["range_end_str"] = format_ms(end_ms)

    output_data = {
        "metadata": meta,
        "stats": stats,
        "messages": deduped,
    }

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"{video_id}.chat.json"
    out_path.write_text(
        json.dumps(output_data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n[done] Saved full chatlog to: {out_path}")
    print(f"       Elapsed        : {elapsed:.1f}s ({total_requests} InnerTube requests)")
    print(f"       Total messages : {stats['total_messages']} (deduped from {len(all_messages)})")
    print(f"       Unique authors : {stats['unique_authors']}")
    print(f"       Types          : {stats['counts_by_type']}")
    if stats["top_activity_windows_60s"]:
        print("       Top 60s spikes :")
        for w in stats["top_activity_windows_60s"]:
            print(f"         - {w['start_str']} - {w['end_str']}: {w['message_count']} msgs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
