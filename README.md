# Klippy

Klippy is a local transcript-first clipping tool for long-form video.

## Features

- Upload a video or audio file in the browser.
- Transcribe locally with the free Whisper `base` model.
- Highlight transcript text, right-click, and remove selected words.
- Highlight transcript text, right-click, and create a clip from the selection.
- Burn per-word captions from the transcript directly into the exported clip.

## Run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Then open `http://127.0.0.1:8000`.
