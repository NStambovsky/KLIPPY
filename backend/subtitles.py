"""
Subtitle generation module.
Produces ASS subtitle files from transcript word timestamps,
re-timed to match the output video after cuts are applied.
"""

import os
import re
import tempfile
from typing import List, Optional


def _ass_time(seconds: float) -> str:
    """Convert seconds to ASS timestamp H:MM:SS.cc"""
    cs = int(round(seconds * 100))
    h = cs // 360000; cs %= 360000
    m = cs // 6000;   cs %= 6000
    s = cs // 100;    cs %= 100
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _alignment_for_position(position: str) -> int:
    return {"bottom": 2, "top": 8, "middle": 5}.get(position, 2)


def _margin_v_for_position(position: str, font_size: int) -> int:
    if position == "top":
        return int(font_size * 0.8)
    if position == "middle":
        return 0
    return int(font_size * 0.6)  # bottom


def build_ass(
    transcript: dict,
    kept_segments: List[dict],
    font_size: int = 72,
    position: str = "bottom",      # "bottom" | "top" | "middle"
    style: str = "word",           # "word" | "sentence"
    all_caps: bool = True,
    outline_size: float = 2.5,
    max_chars: int = 28,
    font_name: str = "Impact",
) -> str:
    """
    Build an ASS subtitle string from a transcript, re-timed to the
    output video timeline (accounting for cuts in kept_segments).

    Returns the full ASS file as a string.
    """
    alignment = _alignment_for_position(position)
    margin_v = _margin_v_for_position(position, font_size)

    # ASS color: &HAABBGGRR
    primary    = "&H00FFFFFF"   # white
    outline_c  = "&H00000000"   # black
    back_c     = "&H80000000"   # semi-transparent black (unused if shadow=0)
    secondary  = "&H000000FF"

    outline_str = f"{outline_size:.1f}"

    header = f"""[Script Info]
ScriptType: v4.00+
WrapStyle: 0
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary},{secondary},{outline_c},{back_c},-1,0,0,0,100,100,0,0,1,{outline_str},0,{alignment},10,10,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # Build a re-timing map: (original_start, original_end) -> output_offset
    segments_map = []
    cumulative = 0.0
    for seg in kept_segments:
        seg_start = seg["start"]
        seg_end = seg["end"]
        seg_dur = seg_end - seg_start
        segments_map.append((seg_start, seg_end, cumulative))
        cumulative += seg_dur

    total_output_duration = cumulative

    def retime(t: float) -> Optional[float]:
        """Map original timestamp to output timeline time. Returns None if cut."""
        for (s, e, offset) in segments_map:
            if s <= t <= e:
                return t - s + offset
        return None

    def retime_range(start: float, end: float):
        """Find the output time range for an original range. Clamp to kept segments."""
        out_start = retime(start)
        out_end = retime(end)
        if out_start is None or out_end is None:
            return None, None
        return out_start, out_end

    dialogues = []

    if style == "word":
        # One dialogue line per word
        for seg in transcript.get("segments", []):
            for word in seg.get("words", []):
                w_text = word.get("word", "").strip()
                if not w_text:
                    continue
                out_s, out_e = retime_range(word["start"], word["end"])
                if out_s is None:
                    continue
                # Minimum word display time: 0.1s
                if out_e - out_s < 0.1:
                    out_e = out_s + 0.1
                text = w_text.upper() if all_caps else w_text
                dialogues.append(
                    f"Dialogue: 0,{_ass_time(out_s)},{_ass_time(out_e)},Default,,0,0,0,,{_escape_ass(text)}"
                )

    else:
        # Sentence mode — one line per segment, wrap at max_chars
        for seg in transcript.get("segments", []):
            text = seg.get("text", "").strip()
            if not text:
                continue
            out_s, out_e = retime_range(seg["start"], seg["end"])
            if out_s is None:
                continue
            if all_caps:
                text = text.upper()
            # Wrap long lines with \N (ASS hard line break)
            wrapped = _wrap_text(text, max_chars)
            dialogues.append(
                f"Dialogue: 0,{_ass_time(out_s)},{_ass_time(out_e)},Default,,0,0,0,,{_escape_ass(wrapped)}"
            )

    return header + "\n".join(dialogues) + "\n"


def write_ass_file(content: str, directory: str = None) -> str:
    """Write ASS content to a temp file with no spaces in path and return its path."""
    import tempfile
    # Always use /tmp — avoids path-with-spaces issues in ffmpeg filtergraph
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".ass", delete=False,
        dir="/tmp", encoding="utf-8"
    ) as f:
        f.write(content)
        return f.name


def _wrap_text(text: str, max_chars: int) -> str:
    """Wrap text at word boundaries, using ASS \\N line break."""
    words = text.split()
    lines = []
    current = ""
    for w in words:
        test = (current + " " + w).strip()
        if len(test) <= max_chars:
            current = test
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return r"\N".join(lines)


def _escape_ass(text: str) -> str:
    """Escape special ASS characters."""
    return text.replace("{", r"\{").replace("}", r"\}")
