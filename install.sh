#!/usr/bin/env bash
#
# install.sh — Bootstrap Emacs + Pi coding agent configuration
#
# Usage:
#   ./install.sh          Run the full installation
#   ./install.sh --help   Show this help message
#
# Platform support: macOS (Homebrew), Linux (apt-get)
#
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--help" ]]; then
  head -n 7 "$0" | tail -n 6
  exit 0
fi

# ── Detect OS ──────────────────────────────────────────────────────
OS="$(uname -s)"

case "$OS" in
  Darwin)
    PKG_MANAGER="brew"
    ;;
  Linux)
    PKG_MANAGER="apt-get"
    ;;
  *)
    echo "ERROR: Unsupported OS '$OS'. Supported: macOS (Darwin), Linux."
    exit 1
    ;;
esac

echo "-- Installing pixi..."

curl -fsSL https://pixi.sh/install.sh | sh

echo "-- Installing system dependencies..."

if [[ "$PKG_MANAGER" == "brew" ]]; then
  brew install emacs clangd
else
  sudo apt-get install -y clangd emacs
fi

echo "-- Installing Pi..."

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source "${HOME}/.bashrc" 2>/dev/null || source "${HOME}/.zshrc" 2>/dev/null || true
nvm install node
npm install -g @earendil-works/pi-coding-agent

echo "-- Symbolic links..."
ln -s "$SCRIPT_DIR/emacs" ~/.emacs.d
ln -s "$SCRIPT_DIR/pi"    ~/.pi

echo "-- Installing Pi plugins..."

pi install npm:pi-web-access
pi install npm:pi-brave-search
pi install npm:pi-md-export
pi install npm:pi-anycopy
pi install npm:pi-agentic-compaction
pi install npm:pi-peon-ping
pi install npm:@aliou/pi-guardrails
pi install npm:pi-subagents

echo "🐍 Python tools..."
pipx install libcst || true
pipx install ruff || true

echo "⚙️ C++ tools..."
npm install -g tree-sitter-cli || true

echo "✅ Done."
