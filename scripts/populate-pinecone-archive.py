#!/usr/bin/env python3
"""
Local Creator Archive Backfill -> Pinecone Serverless Index (otto-creator-archive)

Discovers all public Videos, Livestreams, and Shorts for a YouTube channel via
keyless `yt-dlp`, downloads timestamped `json3` subtitles/auto-captions, chunks
them into overlapping 50-second windows (10s overlap), embeds via Pinecone
Inference (`multilingual-e5-large`), and upserts idempotently into Pinecone.

Zero external pip dependencies (Python 3 stdlib + yt-dlp only).
Reads PINECONE_API_KEY from environment or ~/.omp/agent/.env (never printed).

Usage:
    python scripts/populate-pinecone-archive.py --channel https://www.youtube.com/@roffi_daijoubu
    python scripts/populate-pinecone-archive.py --channel https://www.youtube.com/@roffi_daijoubu --limit 3
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

PINECONE_API_VERSION = "2025-04"
PINECONE_CONTROL_URL = "https://api.pinecone.io"
DEFAULT_INDEX_NAME = "otto-creator-archive"
DEFAULT_NAMESPACE = "default"
EMBED_MODEL = "multilingual-e5-large"
EMBED_DIMENSION = 1024
WINDOW_SEC = 50
OVERLAP_SEC = 10
EMBED_BATCH_SIZE = 48
UPSERT_BATCH_SIZE = 100


def format_sec(sec: int) -> str:
    sec = max(0, int(sec))
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def load_pinecone_api_key() -> str:
    key = os.environ.get("PINECONE_API_KEY", "").strip()
    if key:
        return key
    candidates = [
        Path.home() / ".omp" / "agent" / ".env",
        Path.cwd() / ".env",
    ]
    for p in candidates:
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == "PINECONE_API_KEY":
                val = v.strip().strip('"').strip("'")
                if val:
                    return val
    raise RuntimeError(
        "PINECONE_API_KEY not found in environment or ~/.omp/agent/.env"
    )


def pinecone_request(
    api_key: str,
    method: str,
    url: str,
    body: dict[str, Any] | None = None,
    timeout: int = 60,
    retries: int = 3,
) -> dict[str, Any]:
    headers = {
        "Api-Key": api_key,
        "X-Pinecone-API-Version": PINECONE_API_VERSION,
        "Accept": "application/json",
    }
    data_bytes = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")

    last_err: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")[:400]
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                last_err = RuntimeError(f"Pinecone HTTP {e.code}: {err_body}")
                continue
            raise RuntimeError(f"Pinecone {method} {url} failed (HTTP {e.code}): {err_body}") from e
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2 ** (attempt + 1))
                last_err = e
                continue
            raise
    raise last_err or RuntimeError("Pinecone request failed")


def ensure_index(api_key: str, index_name: str) -> str:
    """Ensure serverless index exists & is ready. Returns index data-plane host."""
    listed = pinecone_request(api_key, "GET", f"{PINECONE_CONTROL_URL}/indexes")
    for idx in listed.get("indexes") or []:
        if idx.get("name") == index_name:
            host = idx.get("host", "")
            if host and (idx.get("status") or {}).get("ready"):
                print(f"[pinecone] Index '{index_name}' ready ({host})")
                return host
            break
    else:
        print(f"[pinecone] Creating serverless index '{index_name}' (dim={EMBED_DIMENSION}, cosine, aws/us-east-1)...")
        pinecone_request(
            api_key,
            "POST",
            f"{PINECONE_CONTROL_URL}/indexes",
            {
                "name": index_name,
                "dimension": EMBED_DIMENSION,
                "metric": "cosine",
                "spec": {"serverless": {"cloud": "aws", "region": "us-east-1"}},
                "deletion_protection": "disabled",
            },
        )

    # Poll until ready
    for _ in range(45):
        info = pinecone_request(api_key, "GET", f"{PINECONE_CONTROL_URL}/indexes/{index_name}")
        if (info.get("status") or {}).get("ready") and info.get("host"):
            print(f"[pinecone] Index '{index_name}' is ready ({info['host']})")
            return str(info["host"])
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for Pinecone index '{index_name}' to become ready.")


def fetch_existing_video_ids(
    api_key: str, host: str, namespace: str, video_ids: list[str]
) -> set[str]:
    """Check which video_ids already have a #0 sentinel vector in Pinecone."""
    existing: set[str] = set()
    batch_size = 50
    for i in range(0, len(video_ids), batch_size):
        batch = video_ids[i : i + batch_size]
        params = [("namespace", namespace)] + [("ids", f"{vid}#0") for vid in batch]
        qs = urllib.parse.urlencode(params)
        res = pinecone_request(api_key, "GET", f"https://{host}/vectors/fetch?{qs}")
        vectors = res.get("vectors") or {}
        for vec_id in vectors.keys():
            if "#" in vec_id:
                existing.add(vec_id.split("#", 1)[0])
    return existing


def discover_channel_videos(
    yt_dlp: str, channel_url: str, include_shorts: bool = True
) -> list[dict[str, Any]]:
    """Discover all public videos/streams/shorts using yt-dlp --flat-playlist."""
    base = channel_url.rstrip("/")
    tabs: list[tuple[str, str]] = [
        ("video", f"{base}/videos"),
        ("live", f"{base}/streams"),
    ]
    if include_shorts:
        tabs.append(("short", f"{base}/shorts"))

    seen: dict[str, dict[str, Any]] = {}
    for content_type, url in tabs:
        print(f"[discover] Scanning {url} ...")
        proc = subprocess.run(
            [
                yt_dlp,
                "--no-update",
                "--flat-playlist",
                "--dump-json",
                "--ignore-errors",
                url,
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        count = 0
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            vid = str(item.get("id") or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]{11}", vid):
                continue
            # Skip currently upcoming/live streams without finished VODs
            live_status = str(item.get("live_status") or "").lower()
            if live_status in ("is_upcoming", "is_live"):
                continue
            if vid in seen:
                continue
            upload_date = str(item.get("upload_date") or "")
            published_at = ""
            if len(upload_date) == 8 and upload_date.isdigit():
                published_at = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}"
            duration = item.get("duration")
            seen[vid] = {
                "video_id": vid,
                "title": str(item.get("title") or "").strip(),
                "published_at": published_at,
                "duration_sec": int(duration) if isinstance(duration, (int, float)) else 0,
                "content_type": content_type,
            }
            count += 1
        print(f"[discover] Found {count} {content_type}(s)")

    return list(seen.values())


def parse_json3_segments(raw_path: Path) -> list[dict[str, Any]]:
    data = json.loads(raw_path.read_text(encoding="utf-8", errors="replace"))
    segments: list[dict[str, Any]] = []
    for ev in data.get("events") or []:
        segs = ev.get("segs")
        if not segs:
            continue
        text = "".join(str(s.get("utf8", "")) for s in segs)
        text = re.sub(r"\s+", " ", text).strip()
        if not text or text in ("[Musik]", "[Music]", "[Applause]", "[Tepuk tangan]"):
            continue
        start_ms = int(ev.get("tStartMs", 0))
        dur_ms = int(ev.get("dDurationMs", 0))
        segments.append(
            {
                "start_sec": start_ms // 1000,
                "end_sec": (start_ms + dur_ms) // 1000,
                "text": text,
            }
        )
    segments.sort(key=lambda s: s["start_sec"])
    return segments


def fetch_video_transcript(
    yt_dlp: str, video_id: str, langs: list[str], tmp_dir: Path
) -> tuple[list[dict[str, Any]], str, str]:
    """Download best subtitle/auto-caption json3 + upload_date if missing."""
    url = f"https://www.youtube.com/watch?v={video_id}"
    out_tpl = str(tmp_dir / "%(id)s.%(ext)s")

    for lang in langs:
        subprocess.run(
            [
                yt_dlp,
                "--no-update",
                "--skip-download",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                lang,
                "--sub-format",
                "json3",
                "--write-info-json",
                "--no-warnings",
                "--quiet",
                "--output",
                out_tpl,
                url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        cand = tmp_dir / f"{video_id}.{lang}.json3"
        if cand.exists():
            published_at = ""
            info_path = tmp_dir / f"{video_id}.info.json"
            if info_path.exists():
                try:
                    info = json.loads(info_path.read_text(encoding="utf-8", errors="replace"))
                    ud = str(info.get("upload_date") or "")
                    if len(ud) == 8 and ud.isdigit():
                        published_at = f"{ud[:4]}-{ud[4:6]}-{ud[6:8]}"
                except Exception:
                    pass
            return parse_json3_segments(cand), lang, published_at

    return [], "", ""


def chunk_segments(
    segments: list[dict[str, Any]],
    window_sec: int = WINDOW_SEC,
    overlap_sec: int = OVERLAP_SEC,
) -> list[dict[str, Any]]:
    """Group timestamped caption segments into overlapping 50s semantic windows."""
    if not segments:
        return []
    chunks: list[dict[str, Any]] = []
    step_sec = max(10, window_sec - overlap_sec)
    max_end = max(s["end_sec"] for s in segments)
    win_start = segments[0]["start_sec"]

    idx = 0
    while win_start <= max_end:
        win_end = win_start + window_sec
        texts: list[str] = []
        actual_start: int | None = None
        actual_end = win_start
        for s in segments:
            if s["start_sec"] >= win_end:
                break
            if s["end_sec"] >= win_start or s["start_sec"] >= win_start:
                if actual_start is None:
                    actual_start = s["start_sec"]
                actual_end = max(actual_end, s["end_sec"], s["start_sec"])
                texts.append(s["text"])
        joined = re.sub(r"\s+", " ", " ".join(texts)).strip()
        if len(joined) >= 25 and actual_start is not None:
            # Cap text length to keep metadata lean & well within embed token limits
            capped = joined[:1600]
            chunks.append(
                {
                    "chunk_index": idx,
                    "start_sec": actual_start,
                    "end_sec": max(actual_end, actual_start + 5),
                    "start_str": format_sec(actual_start),
                    "end_str": format_sec(max(actual_end, actual_start + 5)),
                    "text": capped,
                }
            )
            idx += 1
        if win_end >= max_end:
            break
        win_start += step_sec

    return chunks


def embed_passages(api_key: str, texts: list[str]) -> list[list[float]]:
    all_vecs: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        res = pinecone_request(
            api_key,
            "POST",
            f"{PINECONE_CONTROL_URL}/embed",
            {
                "model": EMBED_MODEL,
                "parameters": {"input_type": "passage", "truncate": "END"},
                "inputs": [{"text": t} for t in batch],
            },
        )
        data = res.get("data") or []
        if len(data) != len(batch):
            raise RuntimeError(f"Embedding count mismatch: expected {len(batch)}, got {len(data)}")
        for row in data:
            all_vecs.append(row["values"])
    return all_vecs


def upsert_vectors(
    api_key: str, host: str, namespace: str, vectors: list[dict[str, Any]]
) -> None:
    for i in range(0, len(vectors), UPSERT_BATCH_SIZE):
        batch = vectors[i : i + UPSERT_BATCH_SIZE]
        pinecone_request(
            api_key,
            "POST",
            f"https://{host}/vectors/upsert",
            {"namespace": namespace, "vectors": batch},
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill YouTube channel transcripts into Pinecone")
    parser.add_argument("--channel", required=True, help="YouTube channel URL (e.g. https://www.youtube.com/@roffi_daijoubu)")
    parser.add_argument("--index", default=DEFAULT_INDEX_NAME, help="Pinecone index name")
    parser.add_argument("--namespace", default=DEFAULT_NAMESPACE, help="Pinecone namespace")
    parser.add_argument("--langs", default="id-orig,id,en-orig,en", help="Comma-separated subtitle languages")
    parser.add_argument("--limit", type=int, default=0, help="Max new videos to index (0 = all)")
    parser.add_argument("--no-shorts", action="store_true", help="Skip /shorts tab")
    parser.add_argument("--force", action="store_true", help="Re-index even if already present in Pinecone")
    parser.add_argument("--dry-run", action="store_true", help="Discover and check Pinecone without indexing")
    args = parser.parse_args()

    yt_dlp = shutil.which("yt-dlp")
    if not yt_dlp:
        print("ERROR: yt-dlp not found in PATH", file=sys.stderr)
        return 1

    api_key = load_pinecone_api_key()
    host = ensure_index(api_key, args.index)

    videos = discover_channel_videos(yt_dlp, args.channel, include_shorts=not args.no_shorts)
    print(f"[summary] Discovered {len(videos)} total unique videos/streams/shorts.")
    if not videos:
        return 0

    existing = set() if args.force else fetch_existing_video_ids(
        api_key, host, args.namespace, [v["video_id"] for v in videos]
    )
    todo = [v for v in videos if v["video_id"] not in existing]
    print(f"[summary] Already in Pinecone: {len(existing)} | Remaining to index: {len(todo)}")

    if args.limit > 0:
        todo = todo[: args.limit]
        print(f"[summary] Capped to --limit {args.limit} video(s) for this run.")

    if args.dry_run:
        for v in todo[:20]:
            print(f"  - [{v['content_type']}] {v['video_id']} | {v['title'][:70]}")
        return 0

    langs = [l.strip() for l in args.langs.split(",") if l.strip()]
    indexed_videos = 0
    no_captions = 0
    failed = 0
    total_chunks = 0

    for pos, video in enumerate(todo, start=1):
        vid = video["video_id"]
        title = video["title"]
        t0 = time.time()
        try:
            with tempfile.TemporaryDirectory(prefix=f"otto_pc_{vid}_") as tmp:
                segs, picked_lang, fetched_pub = fetch_video_transcript(yt_dlp, vid, langs, Path(tmp))
            if not segs:
                no_captions += 1
                print(f"[{pos}/{len(todo)}] SKIP (no captions) {vid} | {title[:60]}")
                continue

            pub_date = video["published_at"] or fetched_pub
            chunks = chunk_segments(segs)
            if not chunks:
                no_captions += 1
                print(f"[{pos}/{len(todo)}] SKIP (empty chunks) {vid} | {title[:60]}")
                continue

            embed_inputs = [
                f"{title}\n[{c['start_str']}] {c['text']}" for c in chunks
            ]
            vecs = embed_passages(api_key, embed_inputs)

            payload: list[dict[str, Any]] = []
            for c, values in zip(chunks, vecs):
                payload.append(
                    {
                        "id": f"{vid}#{c['chunk_index']}",
                        "values": values,
                        "metadata": {
                            "video_id": vid,
                            "title": title[:300],
                            "published_at": pub_date,
                            "content_type": video["content_type"],
                            "start_sec": c["start_sec"],
                            "end_sec": c["end_sec"],
                            "start_str": c["start_str"],
                            "end_str": c["end_str"],
                            "duration_sec": video["duration_sec"],
                            "chunk_index": c["chunk_index"],
                            "lang": picked_lang,
                            "text": c["text"],
                        },
                    }
                )

            upsert_vectors(api_key, host, args.namespace, payload)
            indexed_videos += 1
            total_chunks += len(payload)
            elapsed = time.time() - t0
            print(
                f"[{pos}/{len(todo)}] OK {vid} | {len(payload)} chunks ({picked_lang}) | {elapsed:.1f}s | {title[:55]}"
            )
            time.sleep(0.5)
        except Exception as e:
            failed += 1
            print(f"[{pos}/{len(todo)}] FAIL {vid} | {e}", file=sys.stderr)

    print(
        f"\n[done] Indexed {indexed_videos} videos ({total_chunks} chunks), "
        f"skipped {no_captions} without captions, {failed} failed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
