"""
Transcription module using faster-whisper.
Produces word-level timestamps for transcript-based editing.
"""

import os
import json
from pathlib import Path
from typing import Optional
from faster_whisper import WhisperModel

# Lazily loaded model — shared across requests
_model: Optional[WhisperModel] = None


def get_model(model_size: str = "base") -> WhisperModel:
    global _model
    if _model is None:
        device = "cpu"
        compute_type = "int8"
        try:
            import torch
            if torch.cuda.is_available():
                device = "cuda"
                compute_type = "float16"
        except ImportError:
            pass
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _model


def transcribe(audio_path: str, model_size: str = "base") -> dict:
    """
    Transcribe audio/video and return structured transcript with word timestamps.
    Returns:
        {
            "segments": [
                {
                    "id": int,
                    "start": float,
                    "end": float,
                    "text": str,
                    "words": [{"word": str, "start": float, "end": float, "probability": float}]
                }
            ],
            "language": str,
            "duration": float
        }
    """
    model = get_model(model_size)
    segments_gen, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    segments = []
    for i, seg in enumerate(segments_gen):
        words = []
        if seg.words:
            for w in seg.words:
                words.append({
                    "word": w.word,
                    "start": round(w.start, 3),
                    "end": round(w.end, 3),
                    "probability": round(w.probability, 3),
                })
        segments.append({
            "id": i,
            "start": round(seg.start, 3),
            "end": round(seg.end, 3),
            "text": seg.text.strip(),
            "words": words,
        })

    return {
        "segments": segments,
        "language": info.language,
        "duration": round(info.duration, 3),
    }


def save_transcript(transcript: dict, path: str):
    with open(path, "w") as f:
        json.dump(transcript, f, indent=2)


def load_transcript(path: str) -> dict:
    with open(path) as f:
        return json.load(f)
