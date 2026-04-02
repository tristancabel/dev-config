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
- recursive language and manifest detection
- project-local overrides via `.pi/profiles.json`, `.pi/models.json`, and `.pi/guardrails.json`
- workflow enforcement through Pi extensions

## Recommended
C++:
  cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

Python:
  use ruff + pytest
