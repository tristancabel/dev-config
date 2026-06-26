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
- Dev path: use `dev-planner → builder → reviewer → planner acceptance`; builder fixes accepted blocking findings and repeats review/acceptance up to 3 total loops. When launching a child agent for acceptance, use `planner`; `dev-planner` is the local persona name.
- After acceptance, builder updates `.pi/architecture.md` or `.pi/architecture/<target>.md` when the accepted change affects system aim, targets, structure, data flow, principles, invariants, or validation.
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
- /report
- /report show
- /report save
- /report copy
- /report all
- /plan
- /plan status
- /plan show
- /plan approve
- /plan draft
- /plan edit
- /plan new
- /plan remove
- /plan path
- /architecture status
- /architecture show
- /architecture edit
- /architecture path
- /effort auto|off|minimal|low|medium|high|xhigh
- /context status|refresh|compact
- /memory status|show|edit|path|on|off
- /worktree status|create <name>|use <name>|off|path|list
- /lang refresh
- /lang python on|off|auto
- /lang cpp on|off|auto
- /run <agent> "<task>" (subagents)
- /chain agent1 "<task>" -> agent2 "<task>" (subagents)
- /parallel agent1 "<task>" -> agent2 "<task>" (subagents)
- /subagents-doctor

## Features
- declarative persona profiles
- role-aware permission modes
- automatic oMLX server launch on Pi session start via `start-omlx-server.sh`
- hard read-only isolation for conversation, scout, and dev-planner
- persistent project plan at `.pi/plans/active-plan.md`
- architecture memory at `.pi/architecture.md`, with optional target splits under `.pi/architecture/`
- guided builder workflow with reviewer plus planner acceptance, capped at 3 loops
- internet research tools for conversation and read-only/review personas
- explicit web-use policy per persona
- workflow path switching with `/path`
- quick workflow dashboard with `/workflow status`
- architecture memory dashboard and editor via `/architecture`
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
- session reporting with model, input/output tokens, prompt detail, elapsed time, and estimated equivalent manual effort; `/report` saves a Markdown file by default
- optional subagent delegation for second opinions, parallel review, chains, and background scouting

## Subagents
This setup includes `pi-subagents` for optional child-agent delegation.

Use it when a task benefits from another focused Pi session:
- `oracle` for second opinions before risky decisions
- `scout` for background or fresh-context code exploration
- `planner` for a child-generated implementation plan
- `worker` for executing an already clear plan
- `reviewer` for fresh review, parallel review, and review loops

Keep the parent session as the orchestrator. For everyday small edits and direct questions, the normal persona workflow is simpler.

See [`SUBAGENTS.md`](SUBAGENTS.md) for a tutorial and recommended local workflows.

## macOS Notes
- Worktree staging uses the host temp directory instead of assuming `/tmp`.
- Pi now nudges the agent toward BSD/macOS-compatible shell flags when running on Darwin.
- Read-only personas allow safe macOS inspection commands such as `sw_vers`, `mdfind`, `mdls`, `plutil`, and read-only `brew` queries.

## Recommended
C++:
  cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

Python:
  use ruff + pytest

## Architecture Memory

Each project can keep durable architecture memory in:

```text
.pi/architecture.md
.pi/architecture/<target>.md
```

Use the root file for the current system overview: aim, targets, entry points, data flow, design principles, invariants, validation strategy, and known constraints. If a target-specific section starts crowding the overview, split it into one Markdown file per app, library, service, or tool under `.pi/architecture/`.

Architecture memory is current-state documentation, not a changelog. Dev personas read it automatically in the workflow prompt, and builder updates it after planner acceptance for an architecture-sensitive change.

## oMLX Server Startup
Pi starts the local oMLX server automatically on each session start by running:

```bash
~/.pi/start-omlx-server.sh
```

The launcher is idempotent: if the server is already answering on `127.0.0.1:8000`, it exits without starting another copy. Startup output is appended to `~/.pi/logs/omlx-startup.log`.

Set `PI_AUTO_START_OMLX=0` before launching Pi to skip automatic startup for that session.
