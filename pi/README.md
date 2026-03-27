# Pi Advanced Setup

## Personas
- scout → explore
- planner → design
- builder → implement
- reviewer → audit

## Commands
- /persona
- /lang python on|off
- /lang cpp on|off

## Features
- auto language detection
- pixi enforcement (if pixi.toml)
- clangd-aware C++
- libcst-aware Python
- workflow enforcement

## Recommended
C++:
  cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

Python:
  use ruff + pytest
