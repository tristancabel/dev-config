#!/usr/bin/env bash
set -e

echo "-- Installing pixi..."

curl -fsSL https://pixi.sh/install.sh | sh

echo "-- Installing emacs..."

sudo apt-get install clangd ccls emacs

echo "-- Installing Pi..."

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install node
npm install -g @earendil-work/pi-coding-agent

echo "-- Symbolic links..."
ln -s ~/Tools/dev-config/emacs ~/.emacs.d
ln -s ~/Tools/dev-config/pi ~/.pi

echo "-- Installing Pi plugins..."

pi install npm:pi-web-access
pi install npm:pi-brave-search
pi install npm:pi-md-export
pi install npm:pi-anycopy
#pi install npm:marckrenn/pi-sub-bar
pi install npm:pi-agentic-compaction
pi install npm:pi-peon-ping
pi install npm:@aliou/pi-guardrails


echo "🐍 Python tools..."
pipx install libcst || true
pipx install ruff || true

echo "⚙️ C++ tools..."
npm install -g tree-sitter-cli || true

echo "✅ Done."
