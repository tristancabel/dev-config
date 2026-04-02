# Pi Advanced Setup

## Personas
- scout → read-only exploration
- planner → read-only planning
- builder → implementation, gated by approved plan
- reviewer → read-only audit and validation

## Commands
- /persona
- /plan
- /plan status
- /plan show
- /plan approve
- /plan draft
- /plan edit
- /plan path
- /lang python on|off|auto
- /lang cpp on|off|auto

## Features
- declarative persona profiles
- role-aware permission modes
- hard read-only isolation for scout and planner
- persistent project plan at `.pi/plans/active-plan.md`
- explicit builder approval gate
- auto persona switching with confirmation
- recursive language and manifest detection
- project-local overrides via `.pi/profiles.json` and `.pi/guardrails.json`
- workflow enforcement through Pi extensions

## Recommended
C++:
  cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON

Python:
  use ruff + pytest
