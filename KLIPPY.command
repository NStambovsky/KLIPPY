#!/bin/bash
# KLIPPY.command — double-click to launch KLIPPY from your desktop
# Place this file on your Desktop, then: right-click → Open (first time only)

set -euo pipefail

# ── Where to install KLIPPY ──────────────────────────────────────────────────
INSTALL_DIR="$HOME/KLIPPY"
GITHUB_REPO="https://github.com/NStambovsky/KLIPPY.git"
BRANCH="claude/transcript-video-editor-oCGpD"
FRONTEND_URL="http://localhost:5173"
BACKEND_PORT=8000
FRONTEND_PORT=5173

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}→${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}!${RESET} $*"; }
error()   { echo -e "${RED}✗ ERROR:${RESET} $*" >&2; }
die()     { error "$*"; echo ""; read -p "Press Enter to close..."; exit 1; }

echo ""
echo -e "${BOLD}╔══════════════════════════════╗${RESET}"
echo -e "${BOLD}║   ✂  KLIPPY  Video Editor   ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════╝${RESET}"
echo ""

# ── Check system dependencies ─────────────────────────────────────────────────
info "Checking dependencies..."

check_dep() {
    if ! command -v "$1" &>/dev/null; then
        echo ""
        error "$1 is not installed."
        if [[ "$1" == "ffmpeg" ]]; then
            echo "  Install with Homebrew:  brew install ffmpeg"
            echo "  Or download from:       https://ffmpeg.org/download.html"
        elif [[ "$1" == "python3" ]]; then
            echo "  Install from: https://www.python.org/downloads/"
        elif [[ "$1" == "node" ]]; then
            echo "  Install from: https://nodejs.org/"
        fi
        die "Please install $1 and try again."
    fi
}

check_dep python3
check_dep node
check_dep ffmpeg
success "All dependencies found"

# ── Clone or update repo ──────────────────────────────────────────────────────
if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo ""
    info "Downloading KLIPPY to $INSTALL_DIR ..."
    if ! git clone --branch "$BRANCH" "$GITHUB_REPO" "$INSTALL_DIR" 2>&1; then
        die "Could not clone repository. Check your internet connection and that the repo is public."
    fi
    success "Downloaded"
else
    echo ""
    info "Updating KLIPPY..."
    git -C "$INSTALL_DIR" fetch origin "$BRANCH" --quiet
    git -C "$INSTALL_DIR" checkout "$BRANCH" --quiet
    git -C "$INSTALL_DIR" pull origin "$BRANCH" --quiet 2>/dev/null || warn "Could not pull latest (offline?)"
    success "Up to date"
fi

cd "$INSTALL_DIR"

# ── Backend setup ─────────────────────────────────────────────────────────────
echo ""
info "Setting up Python backend..."
cd "$INSTALL_DIR/backend"

if [ ! -d ".venv" ]; then
    info "Creating Python virtual environment..."
    python3 -m venv .venv
fi

source .venv/bin/activate

info "Installing Python packages (this may take a few minutes on first run)..."
pip install -q --upgrade pip
pip install -q -r requirements.txt
success "Backend ready"

# ── Frontend setup ────────────────────────────────────────────────────────────
echo ""
info "Setting up frontend..."
cd "$INSTALL_DIR/frontend"

if [ ! -d "node_modules" ]; then
    info "Installing Node packages (first-time setup, ~30 seconds)..."
    npm install --silent
fi
success "Frontend ready"

# ── Kill anything on our ports ────────────────────────────────────────────────
for PORT in $BACKEND_PORT $FRONTEND_PORT; do
    EXISTING=$(lsof -ti :"$PORT" 2>/dev/null || true)
    if [ -n "$EXISTING" ]; then
        warn "Port $PORT in use — stopping existing process..."
        kill "$EXISTING" 2>/dev/null || true
        sleep 1
    fi
done

# ── Start backend ─────────────────────────────────────────────────────────────
echo ""
info "Starting backend..."
cd "$INSTALL_DIR/backend"
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port $BACKEND_PORT --log-level warning &
BACKEND_PID=$!

# Wait for backend to be ready
echo -n "  Waiting for backend"
for i in {1..20}; do
    if curl -s "http://localhost:$BACKEND_PORT/health" &>/dev/null; then
        echo ""
        success "Backend running (pid $BACKEND_PID)"
        break
    fi
    echo -n "."
    sleep 0.5
done

# ── Start frontend ────────────────────────────────────────────────────────────
info "Starting frontend..."
cd "$INSTALL_DIR/frontend"
npm run dev --silent &
FRONTEND_PID=$!

# Wait for frontend to be ready
echo -n "  Waiting for frontend"
for i in {1..20}; do
    if curl -s "http://localhost:$FRONTEND_PORT" &>/dev/null; then
        echo ""
        success "Frontend running (pid $FRONTEND_PID)"
        break
    fi
    echo -n "."
    sleep 0.5
done

# ── Open browser ──────────────────────────────────────────────────────────────
echo ""
success "KLIPPY is ready!"
echo ""
echo -e "  ${BOLD}${CYAN}$FRONTEND_URL${RESET}  ← opening in your browser"
echo ""
echo "  API docs: http://localhost:$BACKEND_PORT/docs"
echo ""
echo -e "  ${YELLOW}Keep this window open while using KLIPPY.${RESET}"
echo -e "  ${YELLOW}Close it (or press Ctrl+C) to shut everything down.${RESET}"
echo ""

sleep 1
open "$FRONTEND_URL"

# ── Wait and clean up on exit ─────────────────────────────────────────────────
cleanup() {
    echo ""
    info "Shutting down KLIPPY..."
    kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    success "Stopped. Goodbye!"
    echo ""
}
trap cleanup EXIT SIGINT SIGTERM

wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
