"""
Video/audio processing module using ffmpeg.
Handles cutting, concatenating, and exporting clips.
"""

import os
import json
import subprocess
import tempfile
from pathlib import Path
from typing import List


def get_duration(file_path: str) -> float:
    """Get media duration in seconds via ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            file_path,
        ],
        capture_output=True,
        text=True,
    )
    info = json.loads(result.stdout)
    return float(info["format"]["duration"])


def extract_clip(
    input_path: str,
    output_path: str,
    start: float,
    end: float,
    audio_only: bool = False,
) -> str:
    """Extract a single clip from a media file."""
    duration = end - start
    if duration <= 0:
        raise ValueError(f"Invalid clip: start={start} end={end}")

    codec_args = []
    if audio_only:
        codec_args = ["-vn", "-acodec", "aac"]
    else:
        # Re-encode for clean cuts; use fast preset
        codec_args = [
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac",
        ]

    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start),
        "-i", input_path,
        "-t", str(duration),
        *codec_args,
        "-movflags", "+faststart",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg error: {result.stderr}")
    return output_path


def concatenate_clips(clip_paths: List[str], output_path: str) -> str:
    """Concatenate multiple clip files into one output."""
    if not clip_paths:
        raise ValueError("No clips to concatenate")
    if len(clip_paths) == 1:
        import shutil
        shutil.copy(clip_paths[0], output_path)
        return output_path

    # Write a concat list file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for p in clip_paths:
            abs_p = os.path.abspath(p)
            f.write(f"file '{abs_p}'\n")
        concat_list = f.name

    try:
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list,
            "-c", "copy",
            "-movflags", "+faststart",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg concat error: {result.stderr}")
    finally:
        os.unlink(concat_list)

    return output_path


def export_from_word_selection(
    input_path: str,
    output_path: str,
    kept_segments: List[dict],
    temp_dir: str,
) -> str:
    """
    Export video/audio from a list of kept time ranges.
    kept_segments: [{"start": float, "end": float}, ...]
    """
    if not kept_segments:
        raise ValueError("No segments to export")

    # Detect if input is audio-only
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v", "-show_streams", input_path],
        capture_output=True, text=True,
    )
    audio_only = len(probe.stdout.strip()) == 0

    clip_files = []
    for i, seg in enumerate(kept_segments):
        clip_path = os.path.join(temp_dir, f"_clip_{i}.mp4" if not audio_only else f"_clip_{i}.m4a")
        extract_clip(input_path, clip_path, seg["start"], seg["end"], audio_only=audio_only)
        clip_files.append(clip_path)

    result = concatenate_clips(clip_files, output_path)

    for f in clip_files:
        try:
            os.unlink(f)
        except Exception:
            pass

    return result
