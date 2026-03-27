This is my current emacs-config

# Dependencies

The current LSP dependencies are:

- `eglot` (built into Emacs 29)
- `clangd` or `ccls` for C/C++
- `pyright` for Python

## C and C++

This config prefers `ccls` when it is installed and falls back to
`clangd` automatically otherwise.

### clangd
`sudo apt-get install clangd`

### ccls
If your distro packages it, install it directly. Otherwise build it from source:

```
cd ~/Tools
git clone --depth=1 --recursive https://github.com/MaskRay/ccls/
cd ccls
cmake -H. -BRelease -DCMAKE_BUILD_TYPE=Release
cmake --build Release
export PATH="$PATH:/home/trcabel/Tools/ccls/Release"
```

## Python

### pyright
`conda install -c conda-forge pyright`

## Pi Coding Agent

Install Pi with:
`npm install -g @mariozechner/pi-coding-agent`

For proper terminal rendering inside Emacs, this config uses `eat`.

In Emacs:

- `M-x my/pi-agent` launches Pi in a dedicated terminal buffer.
- `C-c P` launches Pi quickly.
- `C-u M-x my/pi-agent` resumes the last Pi session.
- `C-c p P` does the same from the Projectile project map.

Project-specific instructions for Pi live in `AGENTS.md`.

# Install
To install this emacs config, create a symbolic link from `~.emacs.d` to this directory:

```
cd ~
ln -s ~/Tools/emacs-config .emacs.d
```

## [DEPRECATED] lsp-bridge

1. install pip dependencies
 `pip3 install epc orjson sexpdata six`

2. emacs dependencies **posframe**, **markdown-mode**, **yasnippet**,

3. clone *https://github.com/manateelazycat/lsp-bridge*
