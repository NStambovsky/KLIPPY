import shutil
import subprocess
import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .autoclips import generate_auto_clips
from .models import AutoClipRequest, AutoClipResponse, ClipRequest, ClipResponse, TranscriptResponse
from .settings import CLIPS_DIR, UPLOADS_DIR
from .transcription import transcribe_video
from .video import create_clip


router = APIRouter()


def _find_clip_dir(clip_id: str) -> Path | None:
    for clip_dir in CLIPS_DIR.iterdir():
        if not clip_dir.is_dir():
            continue
        metadata_path = clip_dir / "clip.json"
        if not metadata_path.exists():
            continue
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if metadata.get("clip_id") == clip_id:
            return clip_dir
    return None


@router.post("/transcribe", response_model=TranscriptResponse)
async def transcribe(file: UploadFile = File(...)):
    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
    media_id = uuid4().hex[:12]
    destination = UPLOADS_DIR / f"{media_id}{suffix}"
    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return transcribe_video(media_id=media_id, file_path=destination)


@router.post("/clips", response_model=ClipResponse)
async def make_clip(request: ClipRequest):
    try:
        return create_clip(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Clip generation failed: {exc}") from exc


@router.post("/auto-clips", response_model=AutoClipResponse)
async def auto_clips(request: AutoClipRequest):
    try:
        return generate_auto_clips(request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Auto-clipping failed: {exc}") from exc


@router.get("/clips/{clip_id}/{filename}")
async def get_clip(clip_id: str, filename: str):
    clip_dir = _find_clip_dir(clip_id)
    if clip_dir is None:
        raise HTTPException(status_code=404, detail="Clip not found")
    path = next(clip_dir.glob("*.mp4"), None)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(path, media_type="video/mp4", filename=filename)


@router.post("/clips/{clip_id}/open-folder")
async def open_clip_folder(clip_id: str):
    path = _find_clip_dir(clip_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Clip folder not found")
    clip_file = next(path.glob("*.mp4"), None)
    try:
        if clip_file is not None:
            subprocess.run(
                [
                    "osascript",
                    "-e",
                    f'tell application "Finder" to reveal POSIX file "{clip_file}"',
                    "-e",
                    'tell application "Finder" to activate',
                ],
                check=True,
            )
        else:
            subprocess.run(
                [
                    "osascript",
                    "-e",
                    f'tell application "Finder" to open POSIX file "{path}"',
                    "-e",
                    'tell application "Finder" to activate',
                ],
                check=True,
            )
    except subprocess.CalledProcessError:
        try:
            if clip_file is not None:
                subprocess.run(["open", "-R", str(clip_file)], check=True)
            else:
                subprocess.run(["open", str(path)], check=True)
        except subprocess.CalledProcessError as exc:
            raise HTTPException(status_code=500, detail=f"Could not open clip folder: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not open clip folder: {exc}") from exc
    return {"ok": True, "folder_path": str(path)}


@router.get("/clips/{clip_id}/open-folder")
async def open_clip_folder_get(clip_id: str):
    return await open_clip_folder(clip_id)
