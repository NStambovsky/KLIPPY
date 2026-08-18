#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate

if ! python -c "import fastapi, uvicorn, faster_whisper, moviepy, PIL" >/dev/null 2>&1; then
  pip install -r requirements.txt
fi

URL="http://127.0.0.1:8000"

osascript -e "tell application \"Terminal\" to do script \"cd '$ROOT_DIR' && source .venv/bin/activate && uvicorn app:app --host 127.0.0.1 --port 8000\""
sleep 2
open "$URL"
