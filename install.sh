#!/usr/bin/env bash
# Bootstrap Emacs and either the Tau or Pi coding agent.
# Platform support: macOS (Homebrew), Linux (apt-get).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="tau"
LINK_CONFIG=true

usage() {
  cat <<'HELP'
Usage: ./install.sh [pi|tau] [--no-links]
       ./install.sh --agent pi|tau [--no-links]

Install Emacs and one coding agent (default: tau).
  pi, tau          Choose the coding agent.
  --agent NAME     Choose the coding agent explicitly.
  --no-links       Install tools without linking configuration.
  -h, --help       Show this help.

Existing Pixi installations are reused. Existing configuration directories or
links are preserved; conflicting destinations are reported for manual migration.
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    pi|tau) AGENT="$1"; shift ;;
    --agent)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --agent requires pi or tau." >&2
        exit 1
      fi
      AGENT="$2"
      shift 2
      ;;
    --no-links) LINK_CONFIG=false; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: Unknown argument: $1" >&2; usage >&2; exit 1 ;;
  esac
done
case "$AGENT" in
  pi|tau) ;;
  *) echo "ERROR: Agent must be pi or tau: $AGENT" >&2; exit 1 ;;
esac

case "$(uname -s)" in
  Darwin) PKG_MANAGER="brew" ;;
  Linux) PKG_MANAGER="apt-get" ;;
  *) echo "ERROR: Only macOS and Linux are supported." >&2; exit 1 ;;
esac

# Reuse Pixi on PATH, or its normal installation directory if not on PATH yet.
PIXI_BIN_DIR="${PIXI_HOME:-$HOME/.pixi}/bin"
if ! command -v pixi >/dev/null 2>&1 && [[ -x "$PIXI_BIN_DIR/pixi" ]]; then
  export PATH="$PIXI_BIN_DIR:$PATH"
fi
if command -v pixi >/dev/null 2>&1; then
  echo "-- Reusing Pixi: $(command -v pixi)"
else
  echo "-- Installing Pixi..."
  curl -fsSL https://pixi.sh/install.sh | sh
  export PATH="$PIXI_BIN_DIR:$PATH"
  command -v pixi >/dev/null 2>&1 || { echo "ERROR: Pixi was not found after installation." >&2; exit 1; }
fi

echo "-- Installing system dependencies..."
if [[ "$PKG_MANAGER" == "brew" ]]; then
  brew install emacs clangd
else
  sudo apt-get install -y clangd emacs
fi

if [[ "$AGENT" == "tau" ]]; then
  if command -v tau >/dev/null 2>&1; then
    echo "-- Reusing Tau: $(command -v tau)"
  else
    echo "-- Installing Tau with Pixi..."
    pixi global install tau-ai
  fi
else
  echo "-- Preparing Node.js for Pi..."
  if ! command -v npm >/dev/null 2>&1; then
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
      curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    fi
    # Load nvm directly rather than sourcing interactive shell startup files.
    set +u
    source "$NVM_DIR/nvm.sh"
    nvm install node
    set -u
  fi
  npm install -g @earendil-works/pi-coding-agent
fi

link_config() {
  local source_path="$1" target_path="$2"
  if [[ -L "$target_path" && "$(readlink "$target_path")" == "$source_path" ]]; then
    echo "-- Already linked: $target_path"
  elif [[ -e "$target_path" || -L "$target_path" ]]; then
    echo "-- Preserving existing $target_path; link $source_path manually after migration."
  else
    ln -s "$source_path" "$target_path"
    echo "-- Linked $target_path"
  fi
}

if [[ "$LINK_CONFIG" == true ]]; then
  link_config "$SCRIPT_DIR/emacs" "$HOME/.emacs.d"
  link_config "$SCRIPT_DIR/$AGENT" "$HOME/.$AGENT"
fi

if [[ "$AGENT" == "pi" ]]; then
  echo "-- Installing Pi plugins..."
  for package in \
    pi-web-access pi-brave-search pi-md-export pi-anycopy \
    pi-agentic-compaction pi-peon-ping @aliou/pi-guardrails pi-subagents \
    @juicesharp/rpiv-ask-user-question @plannotator/pi-extension pi-session-cleanup; do
    pi install "npm:$package"
  done
fi

echo "-- Python tools..."
if command -v pipx >/dev/null 2>&1; then
  pipx install libcst || echo "-- Optional libcst installation failed; check pipx manually."
  pipx install ruff || echo "-- Optional ruff installation failed; check pipx manually."
else
  echo "-- Skipping optional Python tools: pipx is not installed."
fi

if command -v npm >/dev/null 2>&1; then
  npm install -g tree-sitter-cli || echo "-- Optional tree-sitter-cli installation failed."
else
  echo "-- Skipping optional tree-sitter-cli: npm is not installed."
fi

echo "-- Done. Selected agent: $AGENT. See $SCRIPT_DIR/$AGENT/README.md for configuration."
