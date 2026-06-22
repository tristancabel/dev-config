# Project Architecture

## Aim
- This repository is a personal development configuration workspace for Emacs and the Pi coding agent.
- The Pi configuration turns a local coding-agent setup into a role-based workflow with planning, implementation, review, validation, web access, guardrails, model routing, project memory, and optional subagents.

## Targets
- `emacs/`: Emacs configuration and documentation.
- `pi/`: Pi coding-agent configuration intended to be symlinked to `~/.pi`.
- `pi/agent/profiles.json`: Declarative persona definitions and baseline workflow instructions.
- `pi/agent/extensions/`: TypeScript extensions that enforce runtime workflow behavior, permissions, status items, commands, model routing, plans, worktrees, language helpers, and startup behavior.
- `pi/hooks/`: Lifecycle hook prompts that append role-specific instructions when `PI_MODE` selects a persona.
- `.pi/`: Project-local workflow state for this repo, including active plans and architecture memory.

## Entry Points and Data Flow
- `install.sh` bootstraps the configuration and symlinks `pi/` to the user's Pi home.
- Pi loads package settings from `pi/agent/settings.json`, profile definitions from `pi/agent/profiles.json`, model routes from `pi/agent/models.json`, and guardrails from `pi/guardrails.json`.
- `pi/agent/extensions/persona.ts` is the main workflow extension. It merges global config with project-local overrides, selects the active persona, applies tool permissions, injects workflow prompt sections, handles `/persona`, `/path`, `/workflow`, `/plan`, `/architecture`, and `/effort`, and persists workflow state into the Pi session.
- `pi/agent/extensions/runtime.ts` provides broader runtime helpers such as context compaction and workflow-state preservation.
- `pi/start-omlx-server.sh` is launched by `pi/agent/extensions/omlx-startup.ts` to keep the local oMLX server available.

## Workflow Principles
- Conversation and planning personas are read-only; builder can edit; reviewer and verifier can run safe checks without mutating project files.
- Development should flow through `dev-planner -> builder -> reviewer -> dev-planner acceptance`.
- Reviewer reports findings and a pass/fail verdict; dev-planner decides whether findings block completion.
- Builder fixes only accepted blocking findings and repeats reviewer plus planner acceptance for at most 3 loops.
- After acceptance, builder updates architecture memory when a change affects current structure, intent, data flow, principles, invariants, targets, or validation.

## Architecture Memory
- `.pi/architecture.md` is the durable current-state overview for a project.
- `.pi/architecture/<target>.md` is used when target-specific detail grows beyond what belongs in the overview.
- Architecture memory is not a changelog. It should describe how the system currently works and why key decisions exist.
- Dev personas read architecture memory automatically through the workflow prompt.

## Invariants
- Read-only personas must not edit files or run mutating shell commands.
- Review-runner personas may run validation and inspection but must not mutate the repository.
- Project-local `.pi/profiles.json`, `.pi/models.json`, and `.pi/guardrails.json` override or extend global Pi configuration.
- Active plan state lives at `.pi/plans/active-plan.md`.
- Shared workflow memory remains rooted at the main repository even when worktree-routed execution is active.

## Validation
- JSON config changes should parse with `node -e` or an equivalent JSON parser.
- TypeScript extension changes should parse or typecheck with the available Pi extension toolchain when available.
- Workflow prompt changes should be reviewed for consistency across `pi/agent/profiles.json`, `pi/hooks/`, and `pi/README.md`.

## Constraints and Tradeoffs
- Most orchestration is prompt- and extension-guided rather than a hard scheduler. This keeps the setup flexible but relies on the active agent to follow the review and acceptance loop.
- Local oMLX model usage can become expensive under parallel subagents, so review loops are capped and parallel review is recommended only for nontrivial diffs.
- Architecture memory is intentionally concise in the root file; target splits should be added only when they improve readability.
