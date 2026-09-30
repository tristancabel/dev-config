# Pi Advanced Setup

## Source of truth

Behavior lives in the code, not in this file. The canonical definitions are:

- `agent/extensions/persona.ts` — personas, paths, `/workflow`, `/plan`, `/architecture`, `/builder`, `/stop`, `/subagent-runs`
- `agent/extensions/runtime.ts`, `report.ts`, `lang-control.ts`, `omlx-startup.ts` — runtime details, reporting, language pinning, local model launch
- `extensions/*.ts` — shared workflow guidance and the per-persona role prompts (scout, dev-planner, builder, reviewer)
- `guardrails.json`, `subagents.capabilities.json`, `agent/models.json`, `agent/profiles.json` — declarative policy
- `evals/check-harness.mjs` — executable contract for the above

This README documents installation and usage. When prose and code disagree, the
code wins; run `node pi/evals/check-harness.mjs` after config changes.

## Funes session memory

Run `funes add pi local` to install the official Pi extension with local retrieval
and automatic indexing. Restart Pi after installation. Tau's `funes_recall`,
`funes_get`, and `funes_status` tools read the same local index. Use the same
`FUNES_HOME` environment variable in both agents if you customize its location.
Tau currently retrieves indexed history but does not automatically index its own
sessions. Check the shared index with `funes status`.

## Personas
- conversation → default Q&A and web research path
- scout → read-only exploration
- dev-planner → clarification-heavy planning after exploration (`planner` and `architect` aliases)
- builder → focused implementation, guided by plans when present
- reviewer → read-only audit and validation
- verifier → executable validation with a required verdict

## Paths
- Conversation path: `conversation` for normal questions, internet lookup, and concise answers.
- Dev path: `dev-planner → builder → focused validation` for normal work; add reviewer and planner acceptance for approved-plan, risky, or architecture-sensitive work.
- Switch with `/path conversation|dev`, inspect with `/workflow status`, and toggle builder delegation with `/builder on|off|status`.

What each persona does is defined in `agent/profiles.json` and the role prompts in `extensions/*.ts`.

## Commands
Quick reference only; the registered set lives in `agent/extensions/*.ts`.

- /persona
- /path status
- /path conversation
- /path dev
- /workflow status
- /builder status
- /builder on
- /builder off
- /subagent-runs status
- /subagent-runs events [run-id-prefix]
- /subagent-runs paths
- /stop
- /stop status
- /stop resume
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
Index only; see [Source of truth](#source-of-truth) for where each is implemented.

- declarative persona profiles with role-aware permission modes; hard read-only isolation for conversation, scout, and dev-planner
- workflow paths, dashboard, and plan management (`/path`, `/workflow`, `/plan`)
- architecture memory at `.pi/architecture.md`, with optional target splits under `.pi/architecture/`
- default-off builder delegation (`/builder`), subagents with an explicit capability policy, and `/subagent-runs` visibility
- automatic oMLX server launch on session start, persona-based model routing, `/effort` overrides
- context management: prompt-section caching and manual compaction (`/context`)
- project memory at `.pi/memory/project-memory.md` and optional worktree-routed execution
- session reporting (`/report`), hard stop (`/stop`), project-local config overrides
- harness evals and model-comparison scenarios under `evals/`
- macOS-aware shell guidance, path normalization, and worktree staging

## Subagents
This setup includes `pi-subagents` for child-agent delegation. Builder delegation is off by default so parent-session tool calls remain visible; toggle it with `/builder on` only for large context-heavy work. What each child agent may do — tools, edit rights, task capsule and return fields — is defined in [`subagents.capabilities.json`](subagents.capabilities.json).

Use subagents for second opinions, parallel review, background scouting, or one bounded worker for a large approved task; keep the parent session as the orchestrator. `/subagent-runs status` and `/subagent-runs events [run-id-prefix]` inspect local async background runs.

See [`SUBAGENTS.md`](SUBAGENTS.md) for a tutorial and recommended local workflows.

## Harness Evals

Run the static harness contract check after changing Pi config or extensions:

```bash
node pi/evals/check-harness.mjs
```

Use `pi/evals/model-comparison.json` to compare the current local oMLX model with alternate persona routes. Save each candidate response and score basic transcript invariants with:

```bash
node pi/evals/score-output.mjs <scenario-id> <transcript-file>
```

See [`evals/README.md`](evals/README.md) for the comparison workflow.

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

Architecture memory is current-state documentation, not a changelog. When personas read it and when builder updates it is defined in the role prompts in `extensions/*.ts`.

## oMLX Server Startup
Pi starts the local oMLX server automatically on each session start by running:

```bash
~/.pi/start-omlx-server.sh
```

The launcher is idempotent: if the server is already answering on `127.0.0.1:8000`, it exits without starting another copy. Startup output is appended to `~/.pi/logs/omlx-startup.log`.

Set `PI_AUTO_START_OMLX=0` before launching Pi to skip automatic startup for that session.
