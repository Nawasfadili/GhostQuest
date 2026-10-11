#!/usr/bin/env bash
# =====================================================
# GhostQuest — One-Command macOS / Linux Installer
# =====================================================
set -e

REPO_ZIP="https://github.com/Nawasfadili/GhostQuest/archive/refs/heads/main.zip"
INSTALL_DIR="$HOME/GhostQuest"
TMP_ZIP="/tmp/GhostQuest-main.zip"
TMP_DIR="/tmp/GhostQuest-extract"

echo ""
echo "  👻 GhostQuest — Automatic Installer"
echo "  ==================================="
echo "  [1/3] Downloading GhostQuest..."
curl -sL "$REPO_ZIP" -o "$TMP_ZIP"

echo "  [2/3] Extracting to $INSTALL_DIR..."
rm -rf "$TMP_DIR" "$INSTALL_DIR"
mkdir -p "$TMP_DIR"
unzip -q "$TMP_ZIP" -d "$TMP_DIR"
mv "$TMP_DIR/GhostQuest-main" "$INSTALL_DIR"
rm -rf "$TMP_ZIP" "$TMP_DIR"

# Copy to clipboard if available
if command -v pbcopy >/dev/null 2>&1; then
  printf "%s" "$INSTALL_DIR" | pbcopy
elif command -v xclip >/dev/null 2>&1; then
  printf "%s" "$INSTALL_DIR" | xclip -selection clipboard
fi

echo "  [3/3] Launching browser..."
if command -v brave-browser >/dev/null 2>&1; then
  brave-browser --load-extension="$INSTALL_DIR" "https://discord.com/quest-home" >/dev/null 2>&1 &
elif command -v google-chrome >/dev/null 2>&1; then
  google-chrome --load-extension="$INSTALL_DIR" "https://discord.com/quest-home" >/dev/null 2>&1 &
elif [ -d "/Applications/Brave Browser.app" ]; then
  open -a "Brave Browser" --args --load-extension="$INSTALL_DIR" "https://discord.com/quest-home"
elif [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" --args --load-extension="$INSTALL_DIR" "https://discord.com/quest-home"
fi

echo ""
echo "  ✅ Installed to: $INSTALL_DIR"
echo "  👉 Open chrome://extensions (or brave://extensions), enable Developer mode,"
echo "     click 'Load unpacked', and select: $INSTALL_DIR"
echo ""
