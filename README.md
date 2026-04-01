# KLIPPY

Lightweight transcript-based video editor. Upload a video or audio file, get a word-level transcript, edit by selecting/deleting words, and export the result. Auto-clip detection surfaces the best moments from long recordings.

## Features

- **Upload** video or audio (MP4, MOV, MKV, MP3, WAV, M4A, and more)
- **Transcribe** with [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (word-level timestamps, VAD filtering)
- **Transcript editor** — click to seek, drag to select, delete words/phrases to cut content
- **Filler word detection** — highlight and bulk-remove "uh", "um", "like", etc.
- **Undo/redo** — full edit history
- **Auto-clip** — automatically finds the most engaging clips from long recordings
- **Export** — re-encodes video/audio with cuts applied via ffmpeg

## Quick Start (local dev)

### Prerequisites

- Python 3.10+
- Node.js 18+
- ffmpeg (`brew install ffmpeg` / `apt install ffmpeg`)

### Run

```bash
./start.sh
```

Opens at **http://localhost:5173**

### Docker

```bash
docker-compose up --build
```

## Architecture

```
KLIPPY/
├── backend/
│   ├── main.py          # FastAPI app — all API routes
│   ├── transcriber.py   # faster-whisper transcription
│   ├── processor.py     # ffmpeg video cutting & concat
│   ├── clipper.py       # auto-clip scoring algorithm
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx                      # Main layout & state
│   │   └── components/
│   │       ├── UploadZone.jsx           # Drag-and-drop upload
│   │       ├── VideoPlayer.jsx          # HTML5 player with controls
│   │       ├── TranscriptEditor.jsx     # Word-level transcript editor
│   │       └── ClipsPanel.jsx           # Auto-clips + exports sidebar
│   └── vite.config.js
├── docker-compose.yml
└── start.sh
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/upload` | Upload media file |
| POST | `/transcribe` | Start transcription job |
| GET | `/job/{id}` | Poll job status |
| GET | `/transcript/{file_id}` | Get cached transcript |
| POST | `/export` | Export clip from kept segments |
| POST | `/auto-clip` | Find best clips automatically |
| GET | `/clips` | List exported clips |
| DELETE | `/clip/{name}` | Delete an exported clip |

## Whisper Models

| Model | Speed | Accuracy |
|-------|-------|----------|
| tiny | Fastest | Basic |
| base | Fast | Good (default) |
| small | Moderate | Better |
| medium | Slow | High |

Models are downloaded automatically on first use (~75MB–1.5GB depending on size).
