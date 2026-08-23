import json
import re
import os
import subprocess
from pathlib import Path
from typing import List, Tuple
from uuid import uuid4

import numpy as np

for candidate in (
    "/opt/homebrew/opt/ffmpeg/bin/ffmpeg",
    "/opt/homebrew/Cellar/ffmpeg/8.1/bin/ffmpeg",
    "ffmpeg",
):
    if candidate == "ffmpeg" or Path(candidate).exists():
        os.environ.setdefault("IMAGEIO_FFMPEG_EXE", candidate)
        break

from moviepy import CompositeVideoClip, ImageClip, VideoFileClip
from PIL import Image, ImageDraw, ImageFont

from .models import CaptionOptions, ClipRequest, ClipResponse, ExportOptions, TranscriptWord
from .settings import CLIPS_DIR, UPLOADS_DIR


FONT_PATHS = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
)
MEDIA_SUFFIXES = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".mp3", ".wav", ".m4a", ".aac"}
EXPORT_PRESETS = {
    "landscape": (1920, 1080),
    "square": (1080, 1080),
    "portrait": (1080, 1920),
}
CAPTION_POSITION_PERCENTS = {
    "top": 16,
    "middle_top": 30,
    "middle": 50,
    "middle_bottom": 64,
    "bottom": 78,
}


def _find_source_media(media_id: str) -> Path | None:
    for path in sorted(UPLOADS_DIR.glob(f"{media_id}.*")):
        if path.suffix.lower() in MEDIA_SUFFIXES:
            return path
    return None


def _find_word_index(words: List[TranscriptWord], word_id: str) -> int:
    for index, word in enumerate(words):
        if word.id == word_id:
            return index
    raise ValueError(f"Word not found: {word_id}")


def _selection_bounds(words: List[TranscriptWord], start_word_id: str, end_word_id: str) -> Tuple[int, int]:
    start_index = _find_word_index(words, start_word_id)
    end_index = _find_word_index(words, end_word_id)
    if start_index > end_index:
        start_index, end_index = end_index, start_index
    return start_index, end_index


def _selected_active_words(words: List[TranscriptWord], start_index: int, end_index: int) -> List[TranscriptWord]:
    return [word for word in words[start_index : end_index + 1] if not word.removed]


def _request_selections(request: ClipRequest) -> List[Tuple[int, int]]:
    selections = request.selections or ([request.selection] if request.selection else [])
    if not selections:
        raise ValueError("No selection provided")

    resolved = [
        _selection_bounds(request.words, selection.start_word_id, selection.end_word_id)
        for selection in selections
    ]
    resolved.sort(key=lambda pair: pair[0])
    return resolved


def _build_srt(words: List[TranscriptWord], clip_start: float, clip_end: float) -> str:
    entries = []
    active_words = [word for word in words if not word.removed and word.end >= clip_start and word.start <= clip_end]
    for index, word in enumerate(active_words, start=1):
        start = max(word.start, clip_start) - clip_start
        end = min(word.end, clip_end) - clip_start
        entries.append(f"{index}\n{_format_time(start)} --> {_format_time(end)}\n{word.text}\n")
    return "\n".join(entries)


def _format_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, ms = divmod(remainder, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"


def _group_caption_words(words: List[TranscriptWord], max_words: int) -> List[Tuple[float, float, str]]:
    groups: List[Tuple[float, float, str]] = []
    batch: List[TranscriptWord] = []

    for word in words:
        if batch and (len(batch) >= max_words or word.start - batch[-1].end > 0.8):
            groups.append((batch[0].start, batch[-1].end, " ".join(item.text for item in batch)))
            batch = []
        batch.append(word)

    if batch:
        groups.append((batch[0].start, batch[-1].end, " ".join(item.text for item in batch)))

    return groups


def _load_font(font_size: int):
    for font_path in FONT_PATHS:
        try:
            return ImageFont.truetype(font_path, font_size)
        except OSError:
            continue
    return ImageFont.load_default()


def _caption_y(position: str, height: int, box_height: int) -> int:
    return max(24, height - box_height - 180)


def _caption_anchor_percent(captions: CaptionOptions) -> float:
    percent = captions.vertical_percent
    if percent <= 0:
        percent = CAPTION_POSITION_PERCENTS.get(captions.position, 78)
    return max(8, min(92, percent)) / 100


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "clip"


def _derive_clip_name(selected_words: List[TranscriptWord]) -> Tuple[str, str]:
    name_parts = []
    for word in selected_words:
        cleaned = re.sub(r"^[^\w]+|[^\w]+$", "", word.text)
        if cleaned:
            name_parts.append(cleaned)
        if len(name_parts) == 4:
            break

    display_name = " ".join(name_parts) if name_parts else "Clip"
    return display_name, f"{_slugify(display_name)}.mp4"


def _stitch_timeline_words(
    words: List[TranscriptWord], selection_ranges: List[Tuple[int, int]]
) -> Tuple[List[TranscriptWord], float]:
    stitched_words: List[TranscriptWord] = []
    timeline_offset = 0.0

    for start_index, end_index in selection_ranges:
        segment_words = _selected_active_words(words, start_index, end_index)
        if not segment_words:
            continue

        segment_start = segment_words[0].start
        segment_end = segment_words[-1].end

        for word in segment_words:
            shifted = word.model_copy(deep=True)
            shifted.start = timeline_offset + (word.start - segment_start)
            shifted.end = timeline_offset + (word.end - segment_start)
            stitched_words.append(shifted)

        timeline_offset += segment_end - segment_start

    return stitched_words, timeline_offset


def _render_caption_image(text: str, size: Tuple[int, int], captions: CaptionOptions) -> np.ndarray:
    width, height = size
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    font = _load_font(captions.font_size)
    max_text_width = int(width * 0.78)
    words = text.split()
    lines: List[str] = []
    current = ""

    for word in words:
        candidate = word if not current else f"{current} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font, stroke_width=2)
        text_width = bbox[2] - bbox[0]
        if text_width <= max_text_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)

    line_heights = []
    line_widths = []
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font, stroke_width=2)
        line_widths.append(bbox[2] - bbox[0])
        line_heights.append(bbox[3] - bbox[1])

    line_gap = max(10, captions.font_size // 5)
    text_block_height = sum(line_heights) + line_gap * max(0, len(lines) - 1)
    box_padding_x = max(18, captions.font_size // 2)
    box_padding_y = max(12, captions.font_size // 3)
    box_width = min(width - 32, max(line_widths, default=0) + box_padding_x * 2)
    box_height = text_block_height + box_padding_y * 2
    box_x = (width - box_width) // 2
    anchor_y = int(height * _caption_anchor_percent(captions))
    box_y = max(24, min(height - box_height - 24, anchor_y - box_height // 2))

    draw.rounded_rectangle(
        [box_x, box_y, box_x + box_width, box_y + box_height],
        radius=24,
        fill=(0, 0, 0, 168),
    )

    current_y = box_y + box_padding_y
    for line, line_width, line_height in zip(lines, line_widths, line_heights):
        text_x = (width - line_width) // 2
        draw.text(
            (text_x, current_y),
            line,
            font=font,
            fill=(255, 255, 255, 255),
            stroke_width=2,
            stroke_fill=(0, 0, 0, 220),
        )
        current_y += line_height + line_gap

    return np.array(image)


def _resolve_export_size(export: ExportOptions) -> Tuple[int, int]:
    if export.preset in EXPORT_PRESETS:
        return EXPORT_PRESETS[export.preset]
    width = max(320, int(export.width))
    height = max(320, int(export.height))
    return width, height


def _ffmpeg_exe() -> str:
    return os.environ.get("IMAGEIO_FFMPEG_EXE", "ffmpeg")


def _segment_time_ranges(words: List[TranscriptWord], selection_ranges: List[Tuple[int, int]]) -> List[Tuple[float, float]]:
    ranges = []
    for start_index, end_index in selection_ranges:
        segment_words = _selected_active_words(words, start_index, end_index)
        if segment_words:
            ranges.append((segment_words[0].start, segment_words[-1].end))
    return ranges


def _reframe_filter(export: ExportOptions) -> str:
    target_width, target_height = _resolve_export_size(export)
    target_ratio = target_width / target_height
    zoom = max(0.5, min(3.0, float(export.zoom or 1.0)))
    wider_expr = f"trunc(ih*{target_ratio}*{zoom}/2)*2"
    taller_expr = f"trunc(iw/{target_ratio}*{zoom}/2)*2"
    return (
        f"scale='if(gte(iw/ih,{target_ratio}),{wider_expr},trunc({target_width}*{zoom}/2)*2)':"
        f"'if(gte(iw/ih,{target_ratio}),trunc({target_height}*{zoom}/2)*2,{taller_expr})',"
        f"crop='min(iw,{target_width})':'min(ih,{target_height})',"
        f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2:color=black"
    )


def _prepare_stitched_media(
    source_path: Path,
    prep_dir: Path,
    words: List[TranscriptWord],
    selection_ranges: List[Tuple[int, int]],
    export: ExportOptions,
) -> Path:
    ffmpeg = _ffmpeg_exe()
    filtergraph = _reframe_filter(export)
    segment_paths = []

    for index, (start, end) in enumerate(_segment_time_ranges(words, selection_ranges)):
        segment_path = prep_dir / f"segment_{index:03}.mp4"
        cmd = [
            ffmpeg,
            "-y",
            "-ss",
            f"{start:.3f}",
            "-to",
            f"{end:.3f}",
            "-i",
            str(source_path),
            "-vf",
            filtergraph,
            "-r",
            "30",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            str(segment_path),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        segment_paths.append(segment_path)

    if not segment_paths:
        raise ValueError("No active words in selected range")

    if len(segment_paths) == 1:
        return segment_paths[0]

    concat_list = prep_dir / "concat.txt"
    concat_list.write_text(
        "\n".join(f"file '{path.name}'" for path in segment_paths),
        encoding="utf-8",
    )
    stitched_path = prep_dir / "stitched.mp4"
    concat_cmd = [
        ffmpeg,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list),
        "-c",
        "copy",
        str(stitched_path),
    ]
    subprocess.run(concat_cmd, check=True, capture_output=True, cwd=str(prep_dir))
    return stitched_path


def _render_captioned_clip(final_clip, output_path: Path, caption_words: List[TranscriptWord], captions: CaptionOptions) -> None:
    overlays = []

    for start, end, text in _group_caption_words(caption_words, max(1, captions.words_per_caption)):
        overlay = (
            ImageClip(_render_caption_image(text, (final_clip.w, final_clip.h), captions))
            .with_start(max(0, start))
            .with_end(max(0.05, end))
        )
        overlays.append(overlay)

    composed_clip = CompositeVideoClip([final_clip, *overlays]) if overlays else final_clip
    try:
        composed_clip.write_videofile(
            str(output_path),
            codec="libx264",
            audio_codec="aac",
            fps=final_clip.fps or 30,
            preset="veryfast",
            ffmpeg_params=["-crf", "23"],
            logger=None,
        )
    finally:
        if composed_clip is not final_clip and hasattr(composed_clip, "close"):
            composed_clip.close()
def create_clip(request: ClipRequest) -> ClipResponse:
    source_path = _find_source_media(request.media_id)
    if source_path is None:
        raise FileNotFoundError("Source media not found")

    selection_ranges = _request_selections(request)
    selected_words = []
    for start_index, end_index in selection_ranges:
        selected_words.extend(_selected_active_words(request.words, start_index, end_index))
    if not selected_words:
        raise ValueError("No active words in selected range")

    clip_start = selected_words[0].start
    clip_end = selected_words[-1].end
    clip_name, file_name = _derive_clip_name(selected_words)
    stitched_words, stitched_duration = _stitch_timeline_words(request.words, selection_ranges)
    clip_id = uuid4().hex[:12]
    clip_dir = CLIPS_DIR / f"{_slugify(clip_name)}-{clip_id[:6]}"
    clip_dir.mkdir(parents=True, exist_ok=True)

    subtitles_path = clip_dir / "captions.srt"
    subtitles_path.write_text(_build_srt(stitched_words, 0.0, stitched_duration), encoding="utf-8")

    output_path = clip_dir / file_name
    prep_dir = clip_dir / "_prep"
    prep_dir.mkdir(parents=True, exist_ok=True)
    prepared_media_path = _prepare_stitched_media(source_path, prep_dir, request.words, selection_ranges, request.export)
    final_clip = VideoFileClip(str(prepared_media_path))
    try:
        if request.captions.enabled:
            _render_captioned_clip(final_clip, output_path, stitched_words, request.captions)
        else:
            final_clip.write_videofile(
                str(output_path),
                codec="libx264",
                audio_codec="aac",
                fps=final_clip.fps or 30,
                preset="veryfast",
                ffmpeg_params=["-crf", "23"],
                logger=None,
            )
    finally:
        if hasattr(final_clip, "close"):
            final_clip.close()

    metadata_path = clip_dir / "clip.json"
    metadata_path.write_text(
        json.dumps(
            {
                "clip_id": clip_id,
                "clip_name": clip_name,
                "file_name": file_name,
                "folder_name": clip_dir.name,
                "media_id": request.media_id,
                "start": clip_start,
                "end": clip_end,
                "stitch_count": len(selection_ranges),
                "captions": request.captions.model_dump(),
                "export": request.export.model_dump(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return ClipResponse(
        clip_id=clip_id,
        clip_name=clip_name,
        file_name=file_name,
        clip_url=f"/api/clips/{clip_id}/{file_name}",
        folder_path=str(clip_dir),
        start=clip_start,
        end=clip_end,
    )
