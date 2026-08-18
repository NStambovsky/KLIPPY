from typing import List, Optional

from pydantic import BaseModel


class TranscriptWord(BaseModel):
    id: str
    text: str
    start: float
    end: float
    removed: bool = False


class TranscriptResponse(BaseModel):
    media_id: str
    filename: str
    duration: float
    words: List[TranscriptWord]


class ClipSelection(BaseModel):
    start_word_id: str
    end_word_id: str


class CaptionOptions(BaseModel):
    enabled: bool = True
    font_size: int = 54
    position: str = "bottom"
    vertical_percent: int = 78
    words_per_caption: int = 4


class ExportOptions(BaseModel):
    preset: str = "landscape"
    width: int = 1920
    height: int = 1080
    zoom: float = 1.0


class ClipRequest(BaseModel):
    media_id: str
    words: List[TranscriptWord]
    selection: Optional[ClipSelection] = None
    selections: List[ClipSelection] = []
    captions: CaptionOptions = CaptionOptions()
    export: ExportOptions = ExportOptions()


class ClipResponse(BaseModel):
    clip_id: str
    clip_name: str
    file_name: str
    clip_url: str
    folder_path: str
    start: float
    end: float


class AutoClipRequest(BaseModel):
    media_id: str
    words: List[TranscriptWord]
    target_count: int = 5
    min_duration: float = 15.0
    max_duration: float = 45.0


class AutoClipSuggestion(BaseModel):
    id: str
    title: str
    preview: str
    start_word_id: str
    end_word_id: str
    start: float
    end: float
    score: float
    reasons: List[str]


class AutoClipResponse(BaseModel):
    media_id: str
    clips: List[AutoClipSuggestion]
