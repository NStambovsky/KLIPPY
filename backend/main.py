"""
KLIPPY — Transcript-based video editor backend.
FastAPI application serving transcription, clip export, and auto-clip endpoints.
"""

import os
import uuid
import asyncio
import shutil
from pathlib import Path
from typing import List, Optional

import aiofiles
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from transcriber import transcribe, save_transcript, load_transcript
from processor import export_from_word_selection, get_duration
from clipper import find_clip_windows, remove_filler_words
from subtitles import build_ass, write_ass_file

# ---------------------------------------------------------------------------
# Directory layout
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
TRANSCRIPTS_DIR = STORAGE_DIR / "transcripts"
CLIPS_DIR = STORAGE_DIR / "clips"
TEMP_DIR = STORAGE_DIR / "temp"

for d in [UPLOADS_DIR, TRANSCRIPTS_DIR, CLIPS_DIR, TEMP_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="KLIPPY", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded media files
app.mount("/media", StaticFiles(directory=str(UPLOADS_DIR)), name="media")
app.mount("/clips-media", StaticFiles(directory=str(CLIPS_DIR)), name="clips-media")

# ---------------------------------------------------------------------------
# In-memory job state  (replace with DB for production)
# ---------------------------------------------------------------------------
jobs: dict = {}  # job_id -> {"status": str, "result": any, "error": str}

ALLOWED_EXTENSIONS = {
    ".mp4", ".mov", ".mkv", ".webm", ".avi",
    ".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac",
}


def _file_id_from_upload(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    return str(uuid.uuid4()) + ext


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class SubtitleConfig(BaseModel):
    enabled: bool = False
    style: str = "word"          # "word" | "sentence"
    position: str = "bottom"     # "bottom" | "top" | "middle"
    font_size: int = 72
    all_caps: bool = True
    outline_size: float = 2.5
    max_chars: int = 28
    font_name: str = "Impact"


class ExportRequest(BaseModel):
    file_id: str
    kept_segments: List[dict]  # [{"start": float, "end": float}]
    output_name: Optional[str] = None
    subtitles: Optional[SubtitleConfig] = None


class AutoClipRequest(BaseModel):
    file_id: str
    num_clips: int = 5
    target_duration: float = 60.0
    min_duration: float = 15.0
    max_duration: float = 90.0


class TranscribeRequest(BaseModel):
    file_id: str
    model_size: str = "base"


class DownloadURLRequest(BaseModel):
    url: str


# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------
def _run_transcription(job_id: str, file_path: str, transcript_path: str, model_size: str):
    try:
        jobs[job_id] = {"status": "running", "result": None, "error": None}
        result = transcribe(file_path, model_size=model_size)
        result = remove_filler_words(result)
        save_transcript(result, transcript_path)
        jobs[job_id] = {"status": "done", "result": result, "error": None}
    except Exception as e:
        jobs[job_id] = {"status": "error", "result": None, "error": str(e)}


def _run_export(
    job_id: str,
    input_path: str,
    output_path: str,
    kept_segments: list,
    subtitle_config: Optional[dict] = None,
    transcript: Optional[dict] = None,
):
    ass_path = None
    try:
        jobs[job_id] = {"status": "running", "result": None, "error": None}

        if subtitle_config and subtitle_config.get("enabled") and transcript:
            ass_content = build_ass(
                transcript=transcript,
                kept_segments=kept_segments,
                font_size=subtitle_config.get("font_size", 72),
                position=subtitle_config.get("position", "bottom"),
                style=subtitle_config.get("style", "word"),
                all_caps=subtitle_config.get("all_caps", True),
                outline_size=subtitle_config.get("outline_size", 2.5),
                max_chars=subtitle_config.get("max_chars", 28),
                font_name=subtitle_config.get("font_name", "Impact"),
            )
            ass_path = write_ass_file(ass_content, str(TEMP_DIR))

        export_from_word_selection(input_path, output_path, kept_segments, str(TEMP_DIR), ass_path=ass_path)
        clip_name = Path(output_path).name
        jobs[job_id] = {"status": "done", "result": {"clip_name": clip_name}, "error": None}
    except Exception as e:
        jobs[job_id] = {"status": "error", "result": None, "error": str(e)}
    finally:
        if ass_path:
            try:
                os.unlink(ass_path)
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a video or audio file. Returns a file_id."""
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    file_id = _file_id_from_upload(file.filename)
    dest = UPLOADS_DIR / file_id

    async with aiofiles.open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):  # 1 MB chunks
            await out.write(chunk)

    try:
        duration = get_duration(str(dest))
    except Exception:
        duration = None

    return {
        "file_id": file_id,
        "filename": file.filename,
        "duration": duration,
        "media_url": f"/media/{file_id}",
    }


@app.post("/download-url")
async def download_url(req: DownloadURLRequest, background_tasks: BackgroundTasks):
    """Download a video from a URL (YouTube, etc.) using yt-dlp."""
    import yt_dlp

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "result": None, "error": None}

    def _do_download(job_id: str, url: str):
        try:
            jobs[job_id] = {"status": "running", "result": None, "error": None}
            file_id = str(uuid.uuid4()) + ".mp4"
            out_path = str(UPLOADS_DIR / file_id)

            base_opts = {
                "format": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "outtmpl": out_path,
                "merge_output_format": "mp4",
                "quiet": True,
                "no_warnings": True,
            }

            # YouTube 403 workaround: try alternate player clients.
            # ios/android clients bypass bot-detection without needing cookies.
            player_clients = [
                ["ios"],
                ["android"],
                ["web"],
            ]
            info = None
            last_err = None
            for clients in player_clients:
                opts = dict(base_opts)
                opts["extractor_args"] = {"youtube": {"player_client": clients}}
                try:
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        info = ydl.extract_info(url, download=True)
                    last_err = None
                    break
                except yt_dlp.utils.DownloadError as e:
                    last_err = e
                    msg = str(e).lower()
                    if "403" in msg or "forbidden" in msg:
                        continue
                    raise

            if last_err:
                raise last_err

            title = info.get("title", "video")
            duration = info.get("duration")

            # yt-dlp may append .mp4 again if merging
            actual_path = out_path
            if not Path(actual_path).exists() and Path(out_path + ".mp4").exists():
                actual_path = out_path + ".mp4"
                file_id = Path(actual_path).name

            if not duration:
                try:
                    duration = get_duration(actual_path)
                except Exception:
                    duration = None

            jobs[job_id] = {
                "status": "done",
                "result": {
                    "file_id": file_id,
                    "filename": f"{title}.mp4",
                    "duration": duration,
                    "media_url": f"/media/{file_id}",
                },
                "error": None,
            }
        except Exception as e:
            jobs[job_id] = {"status": "error", "result": None, "error": str(e)}

    background_tasks.add_task(_do_download, job_id, req.url)
    return {"job_id": job_id, "status": "queued"}


@app.post("/transcribe")
async def start_transcription(req: TranscribeRequest, background_tasks: BackgroundTasks):
    """Start async transcription. Returns a job_id to poll."""
    file_path = UPLOADS_DIR / req.file_id
    if not file_path.exists():
        raise HTTPException(404, "File not found")

    transcript_path = TRANSCRIPTS_DIR / f"{req.file_id}.json"

    # Return cached if available
    if transcript_path.exists():
        transcript = load_transcript(str(transcript_path))
        return {"job_id": None, "status": "done", "transcript": transcript}

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "result": None, "error": None}

    background_tasks.add_task(
        _run_transcription, job_id, str(file_path), str(transcript_path), req.model_size
    )
    return {"job_id": job_id, "status": "queued"}


@app.get("/job/{job_id}")
def get_job(job_id: str):
    """Poll a background job."""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/transcript/{file_id}")
def get_transcript(file_id: str):
    """Get saved transcript for a file."""
    transcript_path = TRANSCRIPTS_DIR / f"{file_id}.json"
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found — run /transcribe first")
    return load_transcript(str(transcript_path))


@app.post("/export")
async def export_clip(req: ExportRequest, background_tasks: BackgroundTasks):
    """Export a clip from kept transcript segments (transcript-based editing)."""
    file_path = UPLOADS_DIR / req.file_id
    if not file_path.exists():
        raise HTTPException(404, "Source file not found")

    if not req.kept_segments:
        raise HTTPException(400, "No segments provided")

    name = req.output_name or f"clip_{uuid.uuid4().hex[:8]}"
    ext = Path(req.file_id).suffix.lower()
    output_name = f"{name}{ext}"
    output_path = CLIPS_DIR / output_name

    # Load transcript if subtitles are requested
    transcript = None
    if req.subtitles and req.subtitles.enabled:
        transcript_path = TRANSCRIPTS_DIR / f"{req.file_id}.json"
        if transcript_path.exists():
            transcript = load_transcript(str(transcript_path))

    subtitle_dict = req.subtitles.model_dump() if req.subtitles else None

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "result": None, "error": None}

    background_tasks.add_task(
        _run_export, job_id, str(file_path), str(output_path),
        req.kept_segments, subtitle_dict, transcript,
    )
    return {"job_id": job_id, "status": "queued", "output_name": output_name}


@app.post("/auto-clip")
async def auto_clip(req: AutoClipRequest, background_tasks: BackgroundTasks):
    """Auto-detect and return the best clips from a transcript."""
    transcript_path = TRANSCRIPTS_DIR / f"{req.file_id}.json"
    if not transcript_path.exists():
        raise HTTPException(404, "Transcript not found — run /transcribe first")

    transcript = load_transcript(str(transcript_path))
    clips = find_clip_windows(
        transcript,
        target_duration=req.target_duration,
        min_duration=req.min_duration,
        max_duration=req.max_duration,
        num_clips=req.num_clips,
    )
    return {"clips": clips}


@app.delete("/file/{file_id}")
def delete_file(file_id: str):
    """Clean up an uploaded file and its transcript."""
    deleted = []
    for d in [UPLOADS_DIR, TRANSCRIPTS_DIR]:
        candidates = list(d.glob(f"{file_id}*"))
        for f in candidates:
            f.unlink(missing_ok=True)
            deleted.append(str(f))
    return {"deleted": deleted}


@app.get("/clips")
def list_clips():
    """List all exported clips."""
    clips = []
    for f in sorted(CLIPS_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.is_file():
            clips.append({
                "name": f.name,
                "size": f.stat().st_size,
                "url": f"/clips-media/{f.name}",
            })
    return {"clips": clips}


@app.delete("/clip/{clip_name}")
def delete_clip(clip_name: str):
    """Delete an exported clip."""
    clip_path = CLIPS_DIR / clip_name
    if not clip_path.exists():
        raise HTTPException(404, "Clip not found")
    clip_path.unlink()
    return {"deleted": clip_name}
