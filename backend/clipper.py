"""
Auto-clipping module.
Scores transcript segments and extracts the most engaging clips.
"""

import re
from typing import List, Optional


# Words that signal engaging content
HIGHLIGHT_WORDS = {
    "important", "key", "critical", "amazing", "incredible", "surprising",
    "secret", "trick", "tip", "mistake", "never", "always", "best", "worst",
    "top", "actually", "honestly", "basically", "literally", "exactly",
    "biggest", "fastest", "easiest", "hardest", "simple", "free",
    "new", "first", "last", "only", "every", "question", "answer",
    "problem", "solution", "reason", "result", "true", "false",
}

FILLER_WORDS = {
    "uh", "um", "like", "you know", "i mean", "sort of", "kind of",
    "basically", "literally", "right", "okay", "so", "well",
}


def score_segment(segment: dict) -> float:
    """Score a transcript segment for clip-worthiness (0-1)."""
    text = segment.get("text", "").lower()
    words = segment.get("words", [])
    duration = segment["end"] - segment["start"]

    if duration <= 0 or not text.strip():
        return 0.0

    score = 0.0

    # Words per minute (higher = more engaging, up to a point)
    word_count = len(text.split())
    wpm = (word_count / duration) * 60
    # Ideal WPM range: 120-180
    if wpm < 60:
        wpm_score = 0.2
    elif wpm < 120:
        wpm_score = 0.5
    elif wpm <= 180:
        wpm_score = 1.0
    elif wpm <= 220:
        wpm_score = 0.7
    else:
        wpm_score = 0.4
    score += wpm_score * 0.3

    # Highlight keyword density
    text_words = set(re.findall(r'\b\w+\b', text))
    highlight_matches = len(text_words & HIGHLIGHT_WORDS)
    highlight_score = min(highlight_matches / max(word_count, 1) * 10, 1.0)
    score += highlight_score * 0.25

    # Average word confidence (whisper probability)
    if words:
        avg_prob = sum(w.get("probability", 0.8) for w in words) / len(words)
        score += avg_prob * 0.2
    else:
        score += 0.8 * 0.2

    # Sentence completeness — ends with punctuation
    stripped = text.strip()
    if stripped and stripped[-1] in ".!?":
        score += 0.15

    # Penalize very short segments
    if duration < 3:
        score *= 0.6
    elif duration > 60:
        score *= 0.8

    return min(score, 1.0)


def find_clip_windows(
    transcript: dict,
    target_duration: float = 60.0,
    min_duration: float = 15.0,
    max_duration: float = 90.0,
    num_clips: int = 5,
    pad_seconds: float = 0.3,
) -> List[dict]:
    """
    Find the top N clip windows from a transcript.
    Uses a sliding window approach over transcript segments.
    Returns a list of clip dicts with start/end/score/text.
    """
    segments = transcript.get("segments", [])
    if not segments:
        return []

    total_duration = transcript.get("duration", 0)
    if total_duration < min_duration:
        # Short file — return it whole
        return [{
            "start": 0,
            "end": total_duration,
            "score": 1.0,
            "text": " ".join(s["text"] for s in segments),
            "title": "Full clip",
        }]

    # Score every segment
    for seg in segments:
        seg["_score"] = score_segment(seg)

    candidates = []

    # Sliding window over segments to build clip candidates
    n = len(segments)
    for i in range(n):
        window_start = segments[i]["start"]
        window_end = window_start
        window_score = 0.0
        window_text_parts = []

        for j in range(i, n):
            seg = segments[j]
            seg_dur = seg["end"] - seg["start"]
            new_dur = seg["end"] - window_start

            if new_dur > max_duration:
                break

            window_end = seg["end"]
            window_score += seg["_score"] * seg_dur
            window_text_parts.append(seg["text"])

            if new_dur >= min_duration:
                # Score normalized by duration closeness to target
                duration_penalty = abs(new_dur - target_duration) / target_duration
                normalized = (window_score / new_dur) * (1 - duration_penalty * 0.3)
                candidates.append({
                    "start": max(0, window_start - pad_seconds),
                    "end": min(total_duration, window_end + pad_seconds),
                    "score": round(normalized, 4),
                    "text": " ".join(window_text_parts).strip(),
                })

    if not candidates:
        # Fallback — just return evenly distributed windows
        return _fallback_clips(segments, total_duration, num_clips, target_duration)

    # Sort by score descending, then pick non-overlapping clips
    candidates.sort(key=lambda c: c["score"], reverse=True)
    selected = []
    for cand in candidates:
        # Check overlap with already selected clips
        overlaps = any(
            not (cand["end"] <= sel["start"] or cand["start"] >= sel["end"])
            for sel in selected
        )
        if not overlaps:
            selected.append(cand)
        if len(selected) >= num_clips:
            break

    # Sort by time order
    selected.sort(key=lambda c: c["start"])

    # Add auto-generated titles
    for i, clip in enumerate(selected):
        clip["title"] = _generate_title(clip["text"], i + 1)

    return selected


def _fallback_clips(
    segments: list,
    total_duration: float,
    num_clips: int,
    target_duration: float,
) -> List[dict]:
    """Evenly distribute clips across the video as a fallback."""
    clips = []
    if total_duration <= 0:
        return clips
    interval = total_duration / num_clips
    for i in range(num_clips):
        start = i * interval
        end = min(start + target_duration, total_duration)
        text_parts = [
            s["text"] for s in segments
            if s["start"] >= start and s["end"] <= end
        ]
        clips.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "score": 0.5,
            "text": " ".join(text_parts).strip(),
            "title": f"Clip {i + 1}",
        })
    return clips


def _generate_title(text: str, index: int) -> str:
    """Generate a short clip title from transcript text."""
    sentences = re.split(r'[.!?]', text)
    first = next((s.strip() for s in sentences if len(s.strip()) > 10), "")
    if first:
        words = first.split()[:6]
        return " ".join(words).capitalize() + "..."
    return f"Clip {index}"


def remove_filler_words(transcript: dict) -> dict:
    """
    Return a modified transcript with filler word segments flagged.
    Doesn't modify the original — returns a copy with 'is_filler' flags.
    """
    import copy
    result = copy.deepcopy(transcript)
    filler_pattern = re.compile(
        r'^\s*(?:' + '|'.join(re.escape(f) for f in FILLER_WORDS) + r')\s*[,.]?\s*$',
        re.IGNORECASE,
    )
    for seg in result.get("segments", []):
        seg["is_filler"] = bool(filler_pattern.match(seg.get("text", "")))
        for word in seg.get("words", []):
            word["is_filler"] = word.get("word", "").strip().lower().rstrip(",.") in FILLER_WORDS
    return result
