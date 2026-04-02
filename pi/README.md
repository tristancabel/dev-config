# Pi Advanced Setup

## Personas
- scout → read-only exploration
- planner → read-only planning
- builder → implementation, gated by approved plan
- reviewer → read-only audit and validation
- verifier → executable validation with a required verdict

## Commands
- /persona
- /plan
- /plan status
- /plan show
- /plan approve
- /plan draft
- /plan edit
- /plan path
- /effort auto|off|minimal|low|medium|high|xhigh
- /context status|refresh|compact
- /memory status|show|edit|path|on|off
- /worktree status|create <name>|use <name>|off|path|list
- /lang refresh
- /lang python on|off|auto
- /lang cpp on|off|auto

## Features
- declarative persona profiles
- role-aware permission modes
- hard read-only isolation for scout and planner
- persistent project plan at `.pi/plans/active-plan.md`
- explicit builder approval gate
- persona-based model routing via `agent/models.json`
- session effort overrides with `/effort`
- dedicated verifier persona with verdict enforcement guidance
- change-type-aware verification templates for frontend, backend, CLI, config, refactor, and bug-fix work
- auto persona switching with confirmation
- deeper project detection for nested roots and monorepos
- macOS-aware shell guidance for BSD utility differences
- prompt-section caching with `/context refresh`
- manual context compaction with workflow-preserving instructions via `/context compact`
- large bash-output persistence into Pi session artifacts with inline previews
- project memory at `.pi/memory/project-memory.md`, with per-session opt-out
- optional worktree-routed execution for risky edits and verification, stored under the host system temp directory
- verifier focus and workflow prompts stay aligned with the active worktree
- project-local overrides via `.pi/profiles.json`, `.pi/models.json`, and `.pi/guardrails.json`
- workflow enforcement through Pi extensions

## macOS Notes
- Worktree staging uses the host temp directory instead of assuming `/tmp`.
- Pi now nudges the agent toward BSD/macOS-compatible shell flags when running on Darwin.
- Read-only personas allow safe macOS inspection commands such as `sw_vers`, `mdfind`, `mdls`, `plutil`, and read-only `brew` queries.

## Recommended
C++:
  cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

Python:
  use ruff + pytest
