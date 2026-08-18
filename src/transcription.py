import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable, List
from uuid import uuid4

from faster_whisper import WhisperModel

from .models import TranscriptResponse, TranscriptWord


def _segment_words(segments: Iterable) -> List[TranscriptWord]:
    words: List[TranscriptWord] = []
    for segment in segments:
        for word in segment.words or []:
            text = (word.word or "").strip()
            if not text:
                continue
            words.append(
                TranscriptWord(
                    id=f"w_{uuid4().hex[:10]}",
                    text=text,
                    start=float(word.start),
                    end=float(word.end),
                )
            )
    return words


@lru_cache(maxsize=1)
def load_model():
    return WhisperModel("base", compute_type="int8")


def transcribe_video(media_id: str, file_path: Path) -> TranscriptResponse:
    model = load_model()
    segments, info = model.transcribe(
        str(file_path),
        word_timestamps=True,
        vad_filter=True,
    )
    segment_list = list(segments)
    words = _segment_words(segment_list)
    payload = TranscriptResponse(
        media_id=media_id,
        filename=file_path.name,
        duration=float(info.duration or (segment_list[-1].end if segment_list else 0.0)),
        words=words,
    )
    file_path.with_suffix(".transcript.json").write_text(
        json.dumps(payload.model_dump(), indent=2),
        encoding="utf-8",
    )
    return payload
