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
