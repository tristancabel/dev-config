# AGENTS.md

This repository is an Emacs configuration.

## Main Files

- `init.el` is the entry point and loads the local configuration files.
- `packages-configuration.el` contains most package setup and editor integrations.
- `variables-configuration.el` contains general editor settings.
- `custom-functions.el` is for interactive helper commands.

## Working Rules

- Prefer `use-package` for package configuration.
- Keep edits ASCII unless the file already needs Unicode.
- Be careful with `custom-set-variables` and `custom-set-faces`; keep them as a single block.
- Avoid editing generated directories such as `elpa/`, `eln-cache/`, `recentf`, and backups unless explicitly asked.

## Validation

- After changing Emacs Lisp, prefer validating with batch byte-compilation of the touched files.
- Keep the config runnable from the repository root, not only through a `~/.emacs.d` symlink.
