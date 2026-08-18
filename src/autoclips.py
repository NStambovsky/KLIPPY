import math
import re
from pathlib import Path
from typing import Iterable, List, Tuple
from uuid import uuid4

import numpy as np
from scenedetect import ContentDetector, SceneManager, open_video
from sklearn.feature_extraction.text import TfidfVectorizer

from .models import AutoClipRequest, AutoClipResponse, AutoClipSuggestion, TranscriptWord
from .settings import UPLOADS_DIR


HOOK_WORDS = {
    "you",
    "your",
    "how",
    "why",
    "what",
    "secret",
    "mistake",
    "truth",
    "best",
    "worst",
    "crazy",
    "insane",
    "important",
    "never",
    "always",
}

def _find_source_media(media_id: str) -> Path | None:
    for path in sorted(UPLOADS_DIR.glob(f"{media_id}.*")):
        if path.suffix.lower() in {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".m4a", ".aac"}:
            return path
    return None


def _sentences(words: List[TranscriptWord]) -> List[dict]:
    sentences = []
    current: List[TranscriptWord] = []
    for index, word in enumerate(words):
        if word.removed:
            continue
        current.append(word)
        is_pause_break = index + 1 < len(words) and (words[index + 1].start - word.end) > 0.85
        is_punct_break = bool(re.search(r"[.!?]$", word.text))
        if is_pause_break or is_punct_break or len(current) >= 30:
            sentences.append(_sentence_payload(current))
            current = []
    if current:
        sentences.append(_sentence_payload(current))
    return sentences


def _sentence_payload(words: List[TranscriptWord]) -> dict:
    text = " ".join(word.text for word in words).strip()
    return {
        "words": words,
        "text": text,
        "start": words[0].start,
        "end": words[-1].end,
        "duration": max(0.01, words[-1].end - words[0].start),
    }


def _candidate_windows(sentences: List[dict], min_duration: float, max_duration: float) -> List[dict]:
    candidates = []
    for start_index in range(len(sentences)):
        total_duration = 0.0
        for end_index in range(start_index, len(sentences)):
            total_duration = sentences[end_index]["end"] - sentences[start_index]["start"]
            if total_duration >= min_duration:
                window_sentences = sentences[start_index : end_index + 1]
                all_words = [word for sentence in window_sentences for word in sentence["words"]]
                candidates.append(
                    {
                        "start_index": start_index,
                        "end_index": end_index,
                        "sentences": window_sentences,
                        "words": all_words,
                        "text": " ".join(sentence["text"] for sentence in window_sentences).strip(),
                        "start": window_sentences[0]["start"],
                        "end": window_sentences[-1]["end"],
                        "duration": total_duration,
                    }
                )
            if total_duration >= max_duration:
                break
    return candidates


def _extract_keywords(full_text: str) -> List[str]:
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=40)
    matrix = vectorizer.fit_transform([full_text])
    feature_names = vectorizer.get_feature_names_out()
    weights = matrix.toarray()[0]
    ranked = np.argsort(weights)[::-1]
    return [feature_names[index] for index in ranked[:12] if weights[index] > 0]


def _scene_cuts(source_path: Path) -> List[float]:
    video = open_video(str(source_path))
    manager = SceneManager()
    manager.add_detector(ContentDetector(threshold=28.0))
    manager.detect_scenes(video)
    return [scene[1].get_seconds() for scene in manager.get_scene_list()]


def _speech_density(words: List[TranscriptWord], duration: float) -> float:
    spoken = sum(max(0.01, word.end - word.start) for word in words)
    return min(1.0, spoken / max(duration, 0.01))


def _internal_pause_penalty(words: List[TranscriptWord]) -> float:
    penalty = 0.0
    for previous, current in zip(words, words[1:]):
        gap = current.start - previous.end
        if gap > 0.55:
            penalty += min(gap, 1.5)
    return penalty


def _hook_score(window: dict) -> float:
    intro = " ".join(word.text.lower() for word in window["words"][:10])
    score = 0.0
    if any(hook in intro for hook in HOOK_WORDS):
        score += 1.0
    if "?" in intro:
        score += 0.6
    if re.search(r"\b(i|we)\b", intro) and re.search(r"\byou\b", intro):
        score += 0.4
    return score


def _keyword_score(text: str, keywords: Iterable[str]) -> float:
    lowered = text.lower()
    hits = sum(1 for keyword in keywords if keyword.lower() in lowered)
    return min(3.0, hits * 0.35)


def _scene_score(start: float, end: float, cuts: List[float]) -> float:
    inside = sum(1 for cut in cuts if start < cut < end)
    edge_bonus = any(abs(cut - start) < 0.75 or abs(cut - end) < 0.75 for cut in cuts)
    return min(1.2, inside * 0.18 + (0.25 if edge_bonus else 0.0))


def _novelty_scores(candidates: List[dict]) -> None:
    texts = [candidate["text"] for candidate in candidates]
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=400)
    matrix = vectorizer.fit_transform(texts).toarray()
    centroid = np.mean(matrix, axis=0)
    centroid_norm = np.linalg.norm(centroid) or 1.0
    for candidate, row in zip(candidates, matrix):
        row_norm = np.linalg.norm(row) or 1.0
        similarity = float(np.dot(row, centroid) / (row_norm * centroid_norm))
        candidate["novelty"] = 1 - similarity


def _score_candidate(window: dict, keywords: List[str], cuts: List[float]) -> Tuple[float, List[str]]:
    duration_target_score = 1 - abs(window["duration"] - 30.0) / 30.0
    density = _speech_density(window["words"], window["duration"])
    pause_penalty = _internal_pause_penalty(window["words"])
    hook = _hook_score(window)
    keyword = _keyword_score(window["text"], keywords)
    scene = _scene_score(window["start"], window["end"], cuts)
    novelty = window.get("novelty", 0.0) * 2.0

    score = (
        duration_target_score * 1.2
        + density * 1.8
        + hook
        + keyword
        + scene
        + novelty
        - pause_penalty * 0.65
    )

    reasons = []
    if hook > 0.8:
        reasons.append("strong opening hook")
    if density > 0.62:
        reasons.append("high speech density")
    if keyword > 0.7:
        reasons.append("keyword-heavy moment")
    if scene > 0.2:
        reasons.append("scene-aware boundaries")
    if novelty > 0.22:
        reasons.append("topically distinct")
    if not reasons:
        reasons.append("clean sentence boundaries")

    return score, reasons[:3]


def _non_overlapping_top(candidates: List[dict], target_count: int) -> List[dict]:
    chosen = []
    occupied = []
    for candidate in sorted(candidates, key=lambda item: item["score"], reverse=True):
        overlaps = any(not (candidate["end"] <= start or candidate["start"] >= end) for start, end in occupied)
        if overlaps:
            continue
        chosen.append(candidate)
        occupied.append((candidate["start"], candidate["end"]))
        if len(chosen) >= target_count:
            break
    return chosen


def generate_auto_clips(request: AutoClipRequest) -> AutoClipResponse:
    source_path = _find_source_media(request.media_id)
    if source_path is None:
        raise FileNotFoundError("Source media not found")

    sentences = _sentences(request.words)
    if not sentences:
        return AutoClipResponse(media_id=request.media_id, clips=[])

    candidates = _candidate_windows(sentences, request.min_duration, request.max_duration)
    if not candidates:
        return AutoClipResponse(media_id=request.media_id, clips=[])

    full_text = " ".join(sentence["text"] for sentence in sentences)
    keywords = _extract_keywords(full_text)
    cuts = _scene_cuts(source_path)
    _novelty_scores(candidates)

    for candidate in candidates:
        candidate["score"], candidate["reasons"] = _score_candidate(candidate, keywords, cuts)

    top_candidates = _non_overlapping_top(candidates, request.target_count)
    suggestions = []
    for candidate in top_candidates:
        preview_words = candidate["words"][:16]
        preview = " ".join(word.text for word in preview_words).strip()
        title_words = [re.sub(r"^[^\w]+|[^\w]+$", "", word.text) for word in candidate["words"][:5]]
        title = " ".join(word for word in title_words if word) or "Suggested clip"
        suggestions.append(
            AutoClipSuggestion(
                id=f"ac_{uuid4().hex[:8]}",
                title=title,
                preview=preview,
                start_word_id=candidate["words"][0].id,
                end_word_id=candidate["words"][-1].id,
                start=candidate["start"],
                end=candidate["end"],
                score=round(candidate["score"], 3),
                reasons=candidate["reasons"],
            )
        )

    return AutoClipResponse(media_id=request.media_id, clips=suggestions)
