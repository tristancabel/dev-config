# dev-config

Dotfiles for **Emacs** and the **Pi coding agent**.

## Directory Structure

```
├── emacs/              Emacs configuration (init.el, packages, custom functions)
├── pi/                 Pi coding agent configuration
│   ├── agent/          Models, profiles, settings, extensions
│   ├── guardrails.json Safety rules for Pi tool execution
│   ├── hooks/          Pi lifecycle hooks
│   └── start-omlx-server.sh oMLX local model server launcher
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

### Local oMLX Model

This config uses a local oMLX server with the `unsloth/Qwen3.6-27B-MLX-8bit` model served on `localhost:8000`.

Start the server with:

```bash
./pi/start-omlx-server.sh
```

Pi also launches this script automatically when a Pi session starts. Set `PI_AUTO_START_OMLX=0` before launching Pi to disable the automatic startup for that session.

The oMLX server API key is configured in `~/.omlx/settings.json` under `auth.api_key`, or with `OMLX_API_KEY` when starting `omlx serve`. `pi/agent/models.json` uses `"apiKey": "OMLX_API_KEY"`, so keep the real secret in your environment, not in git. `authHeader: true` sends it as a bearer token.

### Extensions

The following Pi packages are installed by `install.sh`:

- `pi-web-access` — Web search and content fetching
- `pi-brave-search` — Brave Search integration
- `pi-md-export` — Markdown export
- `pi-anycopy` — Clipboard integration
- `pi-agentic-compaction` — Context compaction
- `pi-peon-ping` — Peon ping
- `@aliou/pi-guardrails` — Safety guardrails
- `pi-subagents` — Child-agent delegation, chains, parallel review, and background runs

See [`pi/SUBAGENTS.md`](pi/SUBAGENTS.md) for the local usage guide.

## Emacs

See [`emacs/README.md`](emacs/README.md) for Emacs-specific setup and keybindings.
