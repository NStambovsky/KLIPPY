#!/bin/bash
# KLIPPY Launcher
# Double-click this file to install dependencies and start KLIPPY.
# First run: right-click → Open to bypass Gatekeeper.

set -e

# ── Homebrew ───────────────────────────────────────────────────────────────────
if [[ -f /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [[ -f /usr/local/bin/brew ]]; then
  eval "$(/usr/local/bin/brew shellenv)"
else
  osascript -e 'display alert "Homebrew not found" message "Install Homebrew first:\n\nhttps://brew.sh" as warning'
  exit 1
fi

# ── ffmpeg ─────────────────────────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo "Installing ffmpeg..."
  brew install ffmpeg
fi

# Ensure ffmpeg has caption support (libfreetype for drawtext, libass for subtitles).
# A minimal or outdated ffmpeg build may be missing these — reinstall to get the
# full Homebrew bottle which includes both.
if ! ffmpeg -filters 2>&1 | grep -q "drawtext"; then
  echo "ffmpeg is missing caption support (libfreetype). Reinstalling..."
  brew reinstall ffmpeg
fi

# ── Node.js ────────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "Installing Node.js..."
  brew install node
fi

# ── Python + faster-whisper ────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "Installing Python 3..."
  brew install python3
fi
if ! python3 -c "import faster_whisper" &>/dev/null 2>&1; then
  echo "Installing faster-whisper..."
  pip3 install faster-whisper --quiet
fi

# ── Repo ───────────────────────────────────────────────────────────────────────
REPO_DIR="$HOME/KLIPPY"

if [[ ! -d "$REPO_DIR" ]]; then
  echo "Cloning KLIPPY..."
  git clone https://github.com/nstambovsky/klippy.git "$REPO_DIR"
else
  echo "Updating KLIPPY..."
  git -C "$REPO_DIR" pull --ff-only 2>/dev/null || true
fi

cd "$REPO_DIR"

# ── npm install ────────────────────────────────────────────────────────────────
echo "Installing dependencies..."
npm install --quiet

# ── Launch ─────────────────────────────────────────────────────────────────────
echo "Starting KLIPPY..."
npm run dev
