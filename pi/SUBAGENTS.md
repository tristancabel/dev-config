# Pi Subagents

This setup installs `pi-subagents` as an orchestration layer on top of the existing persona workflow.

Use the normal profiles for everyday work:

- `conversation` for questions and research
- `scout` for read-only code exploration
- `dev-planner` for clarification and implementation plans
- `builder` for focused edits
- `reviewer` and `verifier` for checks

Builder delegation is off by default. Use `/builder on` only when a task is large enough that preserving parent context is worth the child-session overhead, and `/builder off` to return to visible parent-session implementation.

Use subagents when a task benefits from another focused Pi session: second opinions, parallel review, background scouting, review loops, or a clean fresh-context pass. For normal coding work, direct parent implementation is faster and more observable.

## Installation

Fresh installs run:

```bash
./install.sh
```

Existing installs can add the plugin directly:

```bash
pi install npm:pi-subagents
```

The package is also listed in `agent/settings.json`, so Pi should keep it as part of the configured package set.

## Mental Model

The current Pi session is the parent. A subagent is a child Pi session with a focused role and task.

Subagents do not replace the local persona workflow. The parent should still decide the path, keep user-facing context coherent, and synthesize results. Children are best used as bounded specialists.

With builder delegation on, the parent builder session acts as the orchestrator for implementation tasks that would otherwise burn too much parent context. The child agent burns context privately; the parent receives only compact durable results. That tradeoff is useful for large jobs, but it also hides live tool output, so it should be deliberate.

Task capsules sent to child agents should include only:

- goal
- relevant paths
- constraints
- active plan excerpt
- expected output
- validation commands

Child agents should return only:

- files changed
- concise summary
- validation evidence
- unresolved risks
- blocking questions

The explicit local capability policy is stored in [`subagents.capabilities.json`](subagents.capabilities.json). Treat it as the source of truth when deciding what a child agent may do:

- `scout`, `researcher`, and `oracle` are read-only.
- `reviewer` is review-runner only: it may inspect and validate, but should not mutate the repo.
- `worker` is the only default editing child, and it should receive one bounded task capsule.
- `delegate` is a fallback, not the default for privileged work.
- Parallel child agents must be read-only; do not run parallel editing workers.

Good default pattern:

```text
clarify -> plan -> implement visibly -> validate -> review/accept only when risk justifies it -> architecture update when needed
```

Use subagents sparingly with the local oMLX model. Parallel runs can multiply model load quickly.

Do not use parallel editing workers. Parallel child agents are for read-only scouting or review angles.

Use `/subagent-runs status` to inspect local async background run files and `/subagent-runs events [run-id-prefix]` to show the latest event tail. Foreground subagents report in the parent turn; background subagents should be treated as observable only through their status/event artifacts.

## First Commands

Ask for a second opinion before a risky decision:

```text
Ask oracle for a second opinion on this plan. Challenge assumptions and tell me what I might be missing.
```

Review the current diff:

```text
Use reviewer to review this diff.
```

Run multiple review angles:

```text
Run parallel reviewers on this diff: one for correctness, one for tests, and one for unnecessary complexity.
```

Scout unfamiliar code before planning:

```text
Use scout to inspect the auth flow, then have planner turn that into an implementation plan.
```

Run implementation plus review:

```text
Have worker implement this approved plan. Afterward, run reviewer and summarize only the fixes worth applying.
```

Toggle builder delegation:

```text
/builder status
/builder on
/builder off
```

## Slash Commands

Run one child agent:

```text
/run reviewer "Review this diff for correctness and missing tests."
```

Chain agents in sequence:

```text
/chain scout "Map the auth flow" -> planner "Create a concrete refactor plan"
```

Run agents in parallel:

```text
/parallel reviewer "Check correctness" -> reviewer "Check test coverage" -> reviewer "Check unnecessary complexity"
```

Run in the background:

```text
/run scout "Audit the routing layer and summarize risks" --bg
```

Check active background work:

```text
Show active async runs.
```

Check plugin setup:

```text
/subagents-doctor
```

Check local async run files:

```text
/subagent-runs status
/subagent-runs events
```

## Recommended Local Workflows

### Second Opinion

Use this before large refactors, uncertain architecture, or fixes where the first path feels too easy:

```text
Ask oracle to review my current approach. Focus on hidden assumptions, simpler alternatives, and risks.
```

The oracle should advise. It should not edit files.

### Parallel Review

Use this after nontrivial changes:

```text
Run parallel reviewers on the current diff:
- correctness and edge cases
- tests and validation gaps
- simplicity and maintainability
Then synthesize the findings and apply only high-confidence fixes.
```

This is the best high-value use of subagents in this setup because the parent still owns the implementation while reviewers supply independent checks.

### Background Scout

Use this when the parent can keep working while a child reads a wider area:

```text
Run scout in the background to map the plugin loading flow. Save a concise summary and risks.
```

Avoid background workers unless the task is already well specified and the user understands that progress will be visible through `/subagent-runs`, not normal parent-session tool output.

### Review Loop

Use this for larger or riskier implementation work:

```text
Run a review loop on this change with a max of 3 rounds. Send reviewer findings to planner for acceptance each round, and apply only accepted blocking fixes.
```

Keep the loop capped so local model usage stays predictable. Skip the loop for small, obvious edits where direct validation is enough. After planner accepts an architecture-sensitive implementation, update `.pi/architecture.md` or a target split under `.pi/architecture/` if the accepted change altered the current architecture.

### Delegated Builder

Use this for long implementation work that would otherwise saturate the parent context:

```text
/builder on
Give worker a compact task capsule for the approved plan, then run reviewer and planner acceptance. Keep only summaries and validation evidence in the parent context.
```

The parent should integrate results, resolve blocking questions, and report completion only after review and planner acceptance.

## When Not To Use Subagents

Prefer the existing profiles for:

- tiny edits
- simple questions
- single-file changes
- commands that need only direct validation
- anything where parallel local model load would be annoying

Subagents add coordination overhead. Reach for them when the second set of model eyes is worth that overhead.

## Optional Intercom

`pi-subagents` works without `pi-intercom`. Add `pi-intercom` later only if background child agents often need to ask the parent for decisions while they run.

Suggested prompt if intercom is installed:

```text
Run this implementation in the background. If the worker needs a product decision, ask me instead of guessing.
```

## Model Notes

Builtin subagents inherit the current Pi default model unless overridden. This setup defaults to the local oMLX model in `agent/settings.json`.

For heavier parallel review, consider running fewer agents first:

```text
Use one reviewer for correctness and tests.
```

Then expand to parallel reviewers only when the diff is large enough to justify it.
