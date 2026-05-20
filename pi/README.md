# Pi Advanced Setup

## Personas
- conversation → default Q&A and web research path
- scout → read-only exploration
- dev-planner → clarification-heavy planning after exploration (`planner` and `architect` aliases)
- builder → focused implementation, guided by plans when present
- reviewer → read-only audit and validation
- verifier → executable validation with a required verdict

## Paths
- Conversation path: use `conversation` for normal questions, internet lookup, source fetching, and concise answers.
- Dev path: use `dev-planner → builder → reviewer`; dev-planner grills for clarifications and drafts the approach, builder implements, reviewer audits.
- `/plan approve` marks a plan as ready and keeps useful status metadata, but builder edits are no longer hard-blocked by missing approval.
- `/path conversation` switches to Q&A and web research.
- `/path dev` switches to the dev-planner-first development workflow.
- `/workflow status` shows active path, persona, plan status, active web tools, and builder mode.

## Commands
- /persona
- /path status
- /path conversation
- /path dev
- /workflow status
- /plan
- /plan status
- /plan show
- /plan approve
- /plan draft
- /plan edit
- /plan new
- /plan remove
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
- hard read-only isolation for conversation, scout, and dev-planner
- persistent project plan at `.pi/plans/active-plan.md`
- guided builder workflow with plan status but no approval gate
- internet research tools for conversation and read-only/review personas
- explicit web-use policy per persona
- workflow path switching with `/path`
- quick workflow dashboard with `/workflow status`
- dev-planner aliases: `planner` and `architect`
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
