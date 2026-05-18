# dev-config

Dotfiles for **Emacs** and the **Pi coding agent**.

## Directory Structure

```
├── emacs/              Emacs configuration (init.el, packages, custom functions)
├── pi/                 Pi coding agent configuration
│   ├── agent/          Models, profiles, settings, extensions
│   ├── guardrails.json Safety rules for Pi tool execution
│   ├── hooks/          Pi lifecycle hooks
│   └── start-mlx-server.sh  MLX local model server launcher
├── install.sh          Bootstrap script (macOS + Linux)
└── README.md           This file
```

## Quick Install

```bash
./install.sh
```

Or manually:

```bash
# System dependencies
brew install emacs clangd          # macOS
sudo apt-get install emacs clangd  # Linux

# Node.js + Pi
nvm install node
npm install -g @earendil-works/pi-coding-agent

# Symlinks
ln -s /path/to/dev-config/emacs ~/.emacs.d
ln -s /path/to/dev-config/pi    ~/.pi
```

## Platform Support

- **macOS** — Homebrew for system packages
- **Linux** — apt-get for system packages

## LSP Dependencies

| Language | Server   | Install                              |
|----------|----------|--------------------------------------|
| C/C++    | `clangd` | `brew install clangd` / `apt-get install clangd` |
| Python   | `pyright`| `conda install -c conda-forge pyright` |

## Pi Setup

### Local MLX Model

This config uses a local MLX model (`unsloth/Qwen3.6-27B-MLX-8bit`) served on `localhost:8080`.

Start the server with:

```bash
./pi/start-mlx-server.sh
```

> **Note:** `start-mlx-server.sh` is a placeholder — fill in your model path and launch command before running.

### Extensions

The following Pi packages are installed by `install.sh`:

- `pi-web-access` — Web search and content fetching
- `pi-brave-search` — Brave Search integration
- `pi-md-export` — Markdown export
- `pi-anycopy` — Clipboard integration
- `pi-agentic-compaction` — Context compaction
- `pi-peon-ping` — Peon ping
- `@aliou/pi-guardrails` — Safety guardrails

## Emacs

See [`emacs/README.md`](emacs/README.md) for Emacs-specific setup and keybindings.
