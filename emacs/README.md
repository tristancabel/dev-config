# Emacs Configuration

This is my current emacs-config.

# Dependencies

The current LSP dependencies are:

- `eglot` (built into Emacs 29)
- `clangd` for C/C++
- `pyright` for Python

## C and C++

### clangd
`sudo apt-get install clangd`

## Python

### pyright
`conda install -c conda-forge pyright`

## Pi Coding Agent

Install Pi with:
`npm install -g @earendil-works/pi-coding-agent`

For proper terminal rendering inside Emacs, this config uses `eat`.

In Emacs:

- `M-x my/pi-agent` launches Pi in a dedicated terminal buffer.
- `C-c P` launches Pi quickly.
- `C-u M-x my/pi-agent` resumes the last Pi session.
- `C-c p P` does the same from the Projectile project map.

Project-specific instructions for Pi live in `AGENTS.md`.

# Install

To install this emacs config, create a symbolic link from `~/.emacs.d` to this directory:

```bash
ln -s /path/to/dev-config/emacs ~/.emacs.d
```
