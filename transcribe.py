#!/usr/bin/env python3
"""
KLIPPY transcription worker.
Usage: python3 transcribe.py <audio_path> [model_size]
Outputs JSON to stdout.
"""
import sys
import json

audio_path = sys.argv[1]
model_size = sys.argv[2] if len(sys.argv) > 2 else 'base'

try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({'error': 'faster-whisper not installed. Run: pip3 install faster-whisper'}))
    sys.exit(1)

model = WhisperModel(model_size, device='cpu', compute_type='int8')
segments, info = model.transcribe(audio_path, word_timestamps=True)

words = []
for segment in segments:
    for word in segment.words:
        words.append({
            'word': word.word,
            'startMs': round(word.start * 1000),
            'endMs': round(word.end * 1000),
            'confidence': float(word.probability),
        })

print(json.dumps({'words': words, 'language': info.language}))
