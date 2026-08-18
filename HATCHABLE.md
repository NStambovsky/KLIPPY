# Hatchable Notes

KLIPPY now includes PWA metadata and an offline shell for the static frontend in `static/`.

The current backend is Python-based and depends on local transcription/video tooling. Hatchable cannot run this Python/FFmpeg/Whisper backend as-is, so a full Hatchable deployment needs one of these follow-up paths:

- port the API routes in `app.py` and `src/` to Hatchable JavaScript functions; or
- keep the Python service elsewhere and point the PWA frontend at that API.

The generated `data/` clips folder and local `.venv/` are intentionally ignored.
