#!/usr/bin/env bash
# KLIPPY local dev startup script
set -e

echo "=== KLIPPY — Transcript Video Editor ==="

# Check dependencies
command -v python3 >/dev/null 2>&1 || { echo "Python 3 is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required. Install with: brew install ffmpeg / apt install ffmpeg"; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Backend setup
echo ""
echo "→ Setting up backend..."
cd "$ROOT_DIR/backend"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

# Start backend
echo "→ Starting backend on http://localhost:8000"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend setup
echo ""
echo "→ Setting up frontend..."
cd "$ROOT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    npm install
fi

# Start frontend
echo "→ Starting frontend on http://localhost:5173"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✓ KLIPPY is running!"
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
