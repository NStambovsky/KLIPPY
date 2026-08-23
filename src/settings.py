import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("KLIPPY_DATA_DIR", BASE_DIR / "data"))
UPLOADS_DIR = DATA_DIR / "uploads"
CLIPS_DIR = DATA_DIR / "clips"
STATIC_DIR = BASE_DIR / "static"
