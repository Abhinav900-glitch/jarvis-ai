#!/usr/bin/env bash
# Download Piper voices used by the live TTS backend.
#
#   ./scripts/download_voices.sh en_US-amy-medium
#   ./scripts/download_voices.sh en_GB-alba-medium
#
# Files land in $LIVE_TTS_DATA_DIR (default ~/.local/share/piper-voices).
set -euo pipefail

VOICE="${1:-en_US-amy-medium}"
BASE="${LIVE_TTS_DATA_DIR:-$HOME/.local/share/piper-voices}"
URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium"

case "$VOICE" in
  en_GB-alba-medium) URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium" ;;
  en_US-ryan-high)   URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/high" ;;
  *) echo "Using default source for voice: $VOICE" ;;
esac

mkdir -p "$BASE"
echo "Downloading $VOICE into $BASE …"

curl -fsSL "$URL/en_US-amy-medium.onnx"      -o "$BASE/$VOICE.onnx"      2>/dev/null \
  || curl -fsSL "$URL/$VOICE.onnx"           -o "$BASE/$VOICE.onnx"
curl -fsSL "$URL/en_US-amy-medium.onnx.json" -o "$BASE/$VOICE.onnx.json" 2>/dev/null \
  || curl -fsSL "$URL/$VOICE.onnx.json"      -o "$BASE/$VOICE.onnx.json"

echo "Done. Files in $BASE:"
ls -la "$BASE"
echo
echo "Set LIVE_TTS_DATA_DIR=$BASE and LIVE_TTS_MODEL=$VOICE in your .env"
