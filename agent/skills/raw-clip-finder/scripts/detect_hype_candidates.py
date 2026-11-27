#!/usr/bin/env python3
"""
Stage 1 (0 LLM, pure Python stdlib): Clippable Hype Moment Detector.

Buckets livestream chat into N-second windows, computes 4 rolling-baseline signals
(velocity Z-score, unique author burst Z-score, reaction ratio, emote spam burst),
merges adjacent spikes with setup pre-roll/post-roll, slices YouTube json3 transcript,
and writes compact Candidate Cards (<video_id>.cards.txt) for Otto to curate.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

EMOTE_RE = re.compile(r":[a-zA-Z0-9_-]+:")
REACTION_RE = re.compile(
    r"(?i)(wkwk|wk+w|haha|hehe|ngakak|lmao|lmfao|anjir|anjay|bjir|gila|parah|"
    r"cok|bgst|kontol|bangsat|waduh|astaga|buset|buseet|gokil|mantap|keren|"
    r"no\s?way|wtf|omg|pog|clip|klip|clutch|scam|rip|sad|sedih|nangis|"
    r"kaget|jumpscare|plot\s?twist|menang|kalah|mati|meledak|cabut|lari|"
    r"masyaallah|subhanallah|astaghfirullah|alah|ya\s?allah|bruh|based|real|"
    r"\?{3,}|!{3,}|😂|🤣|😭|💀|🔥|😱|🤯|😡)"
)
SHORT_HYPE_RE = re.compile(r"(?i)^(w+|l+|f+|gg+|gas+|rip+|no+|yes+|yo+|lah+|hah+|eh+|anj+|buset+)$")
STOPWORDS = {
    "yang", "dan", "di", "ke", "dari", "ini", "itu", "ada", "ga", "gak", "ngga",
    "nya", "bang", "bg", "bro", "kak", "yg", "aja", "kok", "sih", "deh", "dong",
    "kan", "lah", "mah", "tuh", "nih", "ya", "yah", "udah", "udh", "lagi", "lg",
    "bisa", "mau", "jadi", "sama", "kalau", "kalo", "kl", "tapi", "tp", "buat",
    "the", "and", "is", "to", "a", "in", "of", "for", "it", "on", "this", "that",
}


def format_sec(sec: int | float) -> str:
    sec_i = max(0, int(round(sec)))
    h, rem = divmod(sec_i, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def rolling_zscores(values: list[float], half_window: int) -> list[float]:
    n = len(values)
    zscores = [0.0] * n
    for i in range(n):
        lo = max(0, i - half_window)
        hi = min(n, i + half_window + 1)
        window = values[lo:hi]
        mean = sum(window) / len(window)
        var = sum((x - mean) ** 2 for x in window) / len(window)
        std = math.sqrt(var)
        zscores[i] = (values[i] - mean) / std if std > 1e-6 else 0.0
    return zscores


def is_reaction_message(text: str) -> bool:
    if not text:
        return False
    stripped = text.strip()
    if REACTION_RE.search(stripped) or SHORT_HYPE_RE.match(stripped):
        return True
    letters = [c for c in stripped if c.isalpha()]
    if len(letters) >= 4 and sum(1 for c in letters if c.isupper()) / len(letters) >= 0.8:
        return True
    return False


def detect_candidates(
    messages: list[dict[str, Any]],
    duration_sec: int,
    bucket_sec: int = 10,
    baseline_sec: int = 300,
    z_threshold: float = 1.5,
    min_authors: int = 3,
    pre_roll_sec: int = 60,
    post_roll_sec: int = 45,
    merge_gap_sec: int = 35,
    skip_intro_sec: int = 90,
    skip_outro_sec: int = 90,
    top_k: int = 15,
) -> list[dict[str, Any]]:
    num_buckets = max(1, (duration_sec // bucket_sec) + 1)
    bucket_msgs: list[list[dict[str, Any]]] = [[] for _ in range(num_buckets)]

    for m in messages:
        ts_ms = m.get("timestamp_ms", 0)
        if ts_ms < 0:
            continue
        b = int(ts_ms // 1000) // bucket_sec
        if 0 <= b < num_buckets:
            bucket_msgs[b].append(m)

    velocities: list[float] = []
    unique_authors: list[float] = []
    reaction_ratios: list[float] = []
    emote_burst_scores: list[float] = []

    for b_list in bucket_msgs:
        count = len(b_list)
        velocities.append(float(count))
        if count == 0:
            unique_authors.append(0.0)
            reaction_ratios.append(0.0)
            emote_burst_scores.append(0.0)
            continue

        authors = {m.get("author_channel_id") or m.get("author") for m in b_list}
        unique_authors.append(float(len(authors)))

        react_cnt = 0
        emote_authors: dict[str, set[str]] = defaultdict(set)
        total_emotes = 0

        for m in b_list:
            txt = m.get("message") or ""
            author_key = m.get("author_channel_id") or m.get("author") or ""
            if is_reaction_message(txt):
                react_cnt += 1
            found_emotes = EMOTE_RE.findall(txt)
            if found_emotes:
                total_emotes += len(found_emotes)
                for em in set(found_emotes):
                    emote_authors[em].add(author_key)

        reaction_ratios.append(react_cnt / count)
        dom_cnt = max((len(v) for v in emote_authors.values()), default=0)
        emote_burst_scores.append(dom_cnt + 0.25 * total_emotes)

    # Adapt min_authors automatically for smaller indie streams
    max_bucket_authors = max(unique_authors, default=0.0)
    eff_min_authors = min(min_authors, max(2, int(max_bucket_authors * 0.4)))

    half_win = max(3, (baseline_sec // bucket_sec) // 2)
    vel_z = rolling_zscores(velocities, half_win)
    auth_z = rolling_zscores(unique_authors, half_win)
    emote_z = rolling_zscores(emote_burst_scores, half_win)
    react_z = rolling_zscores(reaction_ratios, half_win)

    composite: list[float] = []
    for i in range(num_buckets):
        if unique_authors[i] < eff_min_authors:
            composite.append(0.0)
            continue
        score = (
            0.40 * vel_z[i]
            + 0.30 * auth_z[i]
            + 0.15 * max(0.0, emote_z[i])
            + 0.15 * max(0.0, react_z[i])
        )
        composite.append(score)

    eff_skip_intro = skip_intro_sec if duration_sec > 600 else 0
    eff_skip_outro = skip_outro_sec if duration_sec > 600 else 0
    min_b = eff_skip_intro // bucket_sec
    max_b = max(min_b, (duration_sec - eff_skip_outro) // bucket_sec)
    hot_buckets = [i for i in range(min_b, min(num_buckets, max_b)) if composite[i] >= z_threshold]

    clusters: list[tuple[int, int]] = []
    merge_gap_buckets = max(1, merge_gap_sec // bucket_sec)
    for b in hot_buckets:
        if not clusters or b - clusters[-1][1] > merge_gap_buckets:
            clusters.append((b, b))
        else:
            clusters[-1] = (clusters[-1][0], b)

    candidates: list[dict[str, Any]] = []
    for start_b, end_b in clusters:
        peak_b = max(range(start_b, end_b + 1), key=lambda i: composite[i])
        onset_sec = start_b * bucket_sec
        peak_sec = peak_b * bucket_sec
        end_spike_sec = (end_b + 1) * bucket_sec

        win_start = max(0, onset_sec - pre_roll_sec)
        win_end = min(duration_sec, max(end_spike_sec, peak_sec + bucket_sec) + post_roll_sec)

        spike_msgs = [m for i in range(start_b, end_b + 1) for m in bucket_msgs[i]]
        spike_authors = {m.get("author_channel_id") or m.get("author") for m in spike_msgs}
        spike_react_ratio = (
            sum(1 for m in spike_msgs if is_reaction_message(m.get("message") or ""))
            / max(1, len(spike_msgs))
        )

        em_counter: Counter[str] = Counter()
        word_counter: Counter[str] = Counter()
        sample_pool: list[str] = []
        seen_norm_msgs: set[str] = set()

        for m in spike_msgs:
            txt = (m.get("message") or "").strip()
            if not txt:
                continue
            for em in EMOTE_RE.findall(txt):
                em_counter[em] += 1
            clean_txt = EMOTE_RE.sub(" ", txt)
            for tok in re.findall(r"[A-Za-z0-9_]{2,}", clean_txt.lower()):
                if tok not in STOPWORDS and not tok.isdigit():
                    if re.fullmatch(r"(wk)+w?", tok):
                        tok = "wkwk"
                    elif re.fullmatch(r"(ha)+h?", tok):
                        tok = "haha"
                    word_counter[tok] += 1

            norm_key = re.sub(r"\s+", " ", txt.lower())[:40]
            if norm_key not in seen_norm_msgs and len(txt) >= 3:
                seen_norm_msgs.add(norm_key)
                sample_pool.append(txt[:90])

        sample_pool.sort(key=lambda s: (is_reaction_message(s), min(len(s), 45)), reverse=True)
        candidates.append(
            {
                "onset_sec": onset_sec,
                "peak_sec": peak_sec,
                "window_start_sec": win_start,
                "window_end_sec": win_end,
                "window_start_str": format_sec(win_start),
                "window_end_str": format_sec(win_end),
                "peak_str": format_sec(peak_sec),
                "composite_score": round(composite[peak_b], 3),
                "peak_velocity_10s": int(velocities[peak_b]),
                "peak_velocity_z": round(vel_z[peak_b], 2),
                "peak_unique_authors_10s": int(unique_authors[peak_b]),
                "peak_emote_z": round(emote_z[peak_b], 2),
                "spike_total_msgs": len(spike_msgs),
                "spike_unique_authors": len(spike_authors),
                "spike_reaction_pct": round(spike_react_ratio * 100, 1),
                "top_words": word_counter.most_common(8),
                "top_emotes": em_counter.most_common(5),
                "sample_messages": sample_pool[:12],
            }
        )

    candidates.sort(key=lambda c: c["composite_score"], reverse=True)
    selected = candidates[:top_k]
    selected.sort(key=lambda c: c["window_start_sec"])
    for idx, cand in enumerate(selected, start=1):
        cand["candidate_id"] = idx
    return selected


def slice_transcript(segments: list[dict[str, Any]], start_sec: int, end_sec: int) -> list[dict[str, Any]]:
    start_ms = start_sec * 1000
    end_ms = end_sec * 1000
    return [s for s in segments if s["end_ms"] >= start_ms and s["start_ms"] <= end_ms]


def build_candidate_card(cand: dict[str, Any], transcript_segs: list[dict[str, Any]]) -> str:
    words_str = ", ".join(f"{w}({c})" for w, c in cand["top_words"][:6]) or "-"
    emotes_str = ", ".join(f"{e}({c})" for e, c in cand["top_emotes"][:4]) or "-"
    samples_str = " | ".join(cand["sample_messages"][:10]) or "-"

    lines = [
        f"=== CANDIDATE #{cand['candidate_id']} | "
        f"Window: {cand['window_start_str']}-{cand['window_end_str']} "
        f"({cand['window_start_sec']}s-{cand['window_end_sec']}s) | "
        f"Chat Spike: {cand['peak_str']} ({cand['peak_sec']}s) ===",
        f"Signals: score={cand['composite_score']}, peak_10s={cand['peak_velocity_10s']} msgs "
        f"(z={cand['peak_velocity_z']}), unique_authors_10s={cand['peak_unique_authors_10s']}, "
        f"emote_z={cand['peak_emote_z']}, reaction={cand['spike_reaction_pct']}%",
        f"Top words: {words_str}",
        f"Top emotes: {emotes_str}",
        f"Chat samples: {samples_str}",
    ]

    if transcript_segs:
        lines.append("[TRANSCRIPT]")
        buf_start = transcript_segs[0]["start_ms"] // 1000
        buf_texts: list[str] = []
        for seg in transcript_segs:
            s_sec = seg["start_ms"] // 1000
            if s_sec - buf_start >= 6 and buf_texts:
                lines.append(f"  [{format_sec(buf_start)} / {buf_start}s] {' '.join(buf_texts)}")
                buf_start = s_sec
                buf_texts = []
            buf_texts.append(seg["text"])
        if buf_texts:
            lines.append(f"  [{format_sec(buf_start)} / {buf_start}s] {' '.join(buf_texts)}")
    else:
        lines.append("[TRANSCRIPT] (not available)")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage 1 zero-LLM hype candidate detector.")
    parser.add_argument("--chat", type=Path, required=True, help="Path to <video_id>.chat.json")
    parser.add_argument("--transcript", type=Path, default=None, help="Path to <video_id>.transcript.json")
    parser.add_argument("--out-dir", type=Path, required=True, help="Output directory")
    parser.add_argument("--top-k", type=int, default=15, help="Top K candidates (default: 15)")
    parser.add_argument("--z-threshold", type=float, default=1.5, help="Composite Z threshold (default: 1.5)")
    args = parser.parse_args()

    chat_data = json.loads(args.chat.read_text(encoding="utf-8"))
    meta = chat_data.get("metadata") or {}
    messages = chat_data.get("messages") or []
    video_id = meta.get("video_id") or args.chat.stem.split(".")[0]
    duration_sec = int(meta.get("duration_sec") or 0)
    if duration_sec <= 0 and messages:
        duration_sec = int(max(m.get("timestamp_ms", 0) for m in messages) // 1000) + 10

    transcript_segs: list[dict[str, Any]] = []
    if args.transcript and args.transcript.exists():
        t_data = json.loads(args.transcript.read_text(encoding="utf-8"))
        transcript_segs = t_data.get("segments") or []

    candidates = detect_candidates(
        messages=messages,
        duration_sec=duration_sec,
        z_threshold=args.z_threshold,
        top_k=args.top_k,
    )

    cards = [
        build_candidate_card(c, slice_transcript(transcript_segs, c["window_start_sec"], c["window_end_sec"]))
        for c in candidates
    ]
    cards_text = "\n\n".join(cards)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    cand_path = args.out_dir / f"{video_id}.candidates.json"
    cards_path = args.out_dir / f"{video_id}.cards.txt"

    cand_path.write_text(
        json.dumps({"metadata": meta, "candidate_count": len(candidates), "candidates": candidates}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    cards_path.write_text(cards_text, encoding="utf-8")

    print(json.dumps({
        "video_id": video_id,
        "title": meta.get("title", ""),
        "channel": meta.get("channel", ""),
        "duration_sec": duration_sec,
        "total_chat_messages": len(messages),
        "transcript_segments": len(transcript_segs),
        "candidate_count": len(candidates),
        "candidates_path": str(cand_path),
        "cards_path": str(cards_path),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
