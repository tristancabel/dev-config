# Pi Swarm Orchestration Plan

## Goal

Add optional multi-agent swarm orchestration to Pi so the main agent can delegate bounded work to specialized subagents, run parts of a task in parallel, and give the user clear live UI feedback about progress, status, and results.

## Why This Fits Pi Now

- The current Pi setup already has persona profiles, plan approval, verifier workflows, context hygiene, project memory, and optional worktree isolation.
- Pi already exposes extension UI primitives such as `setStatus`, `setWidget`, `renderCall`, `renderResult`, and streaming tool updates.
- Pi also ships a `subagent` example that already proves isolated subprocess delegation, parallel execution, chained workflows, and rich tool rendering are feasible.

## Design Principles

- Swarm mode must be optional. Single-agent Pi remains the default.
- The first version should compose existing Pi primitives instead of requiring core runtime changes.
- Every delegated task must have an owner, a bounded objective, and an explicit result format.
- UI feedback should be live, compact by default, and expandable when the user wants detail.
- Safety rules must get stricter as concurrency increases.
- Orchestration should favor predictable task graphs before dynamic autonomous swarms.

## Proposed Architecture

### Control Layers

- `swarm.ts` extension becomes the orchestrator entry point.
- `subagent`-style execution remains the worker substrate for isolated context windows.
- Existing Pi personas become swarm-capable agent templates rather than being replaced.
- A session-scoped swarm state file tracks active runs, tasks, artifacts, and final outcomes.

### Execution Model

- Start with three modes: `single`, `parallel`, and `chain`.
- Add planner-generated task graphs only after the first three modes are stable.
- Use explicit task objects with agent, task, cwd, worktree mode, and expected output schema.
- Keep merge decisions centralized in the primary agent rather than letting workers write directly into one shared flow without coordination.

### UI Surfaces

- Footer status for overall swarm health and active counts.
- Editor widget for active run summary, task states, and blockers.
- Rich tool rendering for the swarm tool row with collapsed and expanded views.
- Custom message rendering for run summaries, failures, and approval checkpoints.
- RPC-compatible event emission so IDE clients can mirror the same progress state.

## User Stories

### Story 1: Declarative Swarm Agent Catalog

As a Pi user, I want swarm-capable agents to be defined in structured config so that delegation targets are explicit and reusable.

Acceptance criteria:

- Pi supports a catalog of swarm agents with names, descriptions, tools, model routes, and safety modes.
- Agents can be global or project-local, with project-local agents gated behind trust confirmation.
- Existing personas such as `scout`, `planner`, `builder`, and `verifier` can be exposed through the same catalog.
- The catalog format is easy to extend with swarm-only roles such as `synthesizer` or `merger`.

### Story 2: Swarm Command Surface

As a Pi user, I want a dedicated swarm command surface so that orchestration is intentional instead of hidden inside prompts.

Acceptance criteria:

- Pi exposes commands such as `/swarm`, `/swarm status`, `/swarm abort`, `/swarm runs`, and `/swarm inspect`.
- The command surface can launch single, parallel, and chained delegations.
- Commands validate parameters and explain errors clearly.
- The current single-agent workflow is unaffected when swarm commands are not used.

### Story 3: Session-Scoped Swarm Run Persistence

As a Pi user, I want swarm runs to be persisted so that I can inspect what happened after the live UI is gone.

Acceptance criteria:

- Each swarm run gets a stable Pi-owned run record.
- Run records include task definitions, timestamps, task status, summaries, and artifacts.
- A prior run can be shown again without rerunning it.
- Failed and partial runs are preserved with enough data to debug them.

### Story 4: Live Footer Status For Swarm Activity

As a Pi user, I want footer-level status feedback so that I can tell at a glance whether the swarm is idle, running, blocked, or failed.

Acceptance criteria:

- Pi shows a compact footer status such as `swarm:2/5 running`.
- Status changes live as tasks start, finish, fail, or block on approval.
- The status line differentiates healthy progress from degraded states.
- Status clears or settles cleanly when a run finishes or is aborted.

### Story 5: Progress Widget For Active Swarm Runs

As a Pi user, I want a widget that shows task-level progress so that I can track the swarm without expanding every tool row.

Acceptance criteria:

- Pi shows a widget with active run id, tasks, owners, and state.
- The widget supports at least queued, running, done, failed, blocked, and canceled states.
- The widget stays useful in both short and long runs.
- The widget is removable when no swarm work is active.

### Story 6: Rich Swarm Tool Rendering

As a Pi user, I want the swarm tool output to be readable in both collapsed and expanded views so that parallel work does not become noise.

Acceptance criteria:

- Collapsed view shows a concise status summary and recent activity.
- Expanded view shows per-task logs, agent output, usage, and artifacts.
- Streaming updates appear live while tasks are running.
- Final rendering clearly distinguishes success, failure, and partial completion.

### Story 7: Single Delegation Mode

As a Pi user, I want the main agent to delegate one bounded task to one specialized agent so that I can benefit from isolation without full swarm complexity.

Acceptance criteria:

- Pi can run one delegated task with one named agent.
- The delegated agent has isolated context and returns a structured summary.
- The main agent can use that result in the same turn or next turn.
- Failures are surfaced clearly to the user and to the parent agent.

### Story 8: Parallel Fan-Out Mode

As a Pi user, I want Pi to run independent tasks in parallel so that exploration and verification can finish faster.

Acceptance criteria:

- Pi accepts an array of independent tasks for parallel execution.
- Concurrency is capped by configuration.
- The UI shows aggregate progress and per-task state.
- The final result includes both aggregate status and individual task results.

### Story 9: Sequential Chain Mode

As a Pi user, I want Pi to run chained tasks where later agents consume earlier output so that multi-step workflows can stay structured.

Acceptance criteria:

- Pi supports a chain of ordered tasks.
- Later tasks can reference earlier output through explicit placeholders or typed inputs.
- Chain execution stops cleanly on failure unless configured otherwise.
- The UI makes the current step and next step obvious.

### Story 10: Planner-Generated Task Graphs

As a Pi user, I want the planner to be able to propose a swarm task graph so that orchestration can be derived from the work rather than hardcoded every time.

Acceptance criteria:

- The planner can emit a graph or task list in a structured format.
- The user can inspect and approve the task graph before execution.
- The task graph supports at least serial and parallel edges.
- Invalid or unsafe graphs are rejected before execution starts.

### Story 11: Structured Handoffs Between Agents

As a Pi user, I want handoffs to use a structured schema so that downstream agents receive the right context without bloating prompts.

Acceptance criteria:

- Handoffs include task objective, constraints, relevant files, evidence, and expected output shape.
- Handoff size is bounded and compactable.
- Agents can attach artifacts or saved outputs instead of inlining everything.
- The synthesizing agent can reconstruct the swarm outcome from the handoff records.

### Story 12: Budget And Concurrency Controls

As a Pi user, I want configurable swarm budgets so that multi-agent execution does not run away on cost or context.

Acceptance criteria:

- Pi supports maximum parallel tasks, maximum total tasks, and per-run limits.
- Pi can stop launching new tasks when the run exceeds a budget.
- Budget state is visible in the UI.
- Budget failures produce a partial but usable run summary.

### Story 13: Approval Gates For Risky Swarm Actions

As a Pi user, I want risky swarm operations to require approval so that concurrency does not bypass the safety posture we already built.

Acceptance criteria:

- Swarm runs can require approval before edit-capable workers start.
- Project-local swarm agents can be gated separately from user-level agents.
- High-risk actions such as enabling shared-write execution or large worker counts can require confirmation.
- Approval checkpoints are visible in both TUI and RPC flows.

### Story 14: Worktree Isolation Per Worker

As a Pi user, I want edit-capable workers to use isolated worktrees so that concurrent changes do not trample each other.

Acceptance criteria:

- Workers can be assigned unique worktrees or grouped worktrees by task.
- Worktree ownership is visible in the run state and UI.
- Read-only workers can avoid unnecessary worktree creation.
- Merge or cherry-pick strategy is explicit rather than implicit.

### Story 15: Synthesizer And Mergeback Workflow

As a Pi user, I want one agent to synthesize worker results back into a single answer or patch plan so that swarm output becomes actionable.

Acceptance criteria:

- Pi can designate a synthesizer or merger role.
- The synthesizer receives task outputs, failures, and artifact references.
- The synthesized result clearly marks what is final versus what still needs user review.
- Mergeback strategy is visible when multiple workers touched different worktrees.

### Story 16: Abort, Retry, And Resume Controls

As a Pi user, I want to abort, retry, or resume swarm runs so that orchestration remains manageable when things go wrong.

Acceptance criteria:

- Pi can abort one task or an entire run.
- Pi can retry only failed tasks when their inputs are still valid.
- Pi can resume from persisted run state where feasible.
- The UI reflects canceled and resumed states accurately.

### Story 17: RPC And IDE Client Feedback

As a Pi user, I want the same swarm progress to be available in RPC and IDE clients so that orchestration is not interactive-TUI only.

Acceptance criteria:

- Swarm state changes are representable through existing Pi RPC UI requests or companion events.
- IDE clients can mirror footer status, widgets, and run summaries.
- Lack of TUI features in a client degrades gracefully instead of breaking execution.
- Run records remain the source of truth across UI frontends.

### Story 18: Swarm Evaluation And Test Harness

As a Pi maintainer, I want a repeatable test harness for swarm workflows so that concurrency and UI changes do not regress silently.

Acceptance criteria:

- Pi has fixture tasks for single, parallel, chain, and partial-failure runs.
- UI state reducers or serializers are testable without a full live TUI.
- Run-state persistence is covered by regression tests.
- The test harness includes at least one abort path and one approval-gated path.

## Suggested Milestones

### Milestone 1: Minimal Delegation

- Story 1: Declarative Swarm Agent Catalog
- Story 2: Swarm Command Surface
- Story 3: Session-Scoped Swarm Run Persistence
- Story 7: Single Delegation Mode

### Milestone 2: User-Facing Swarm Feedback

- Story 4: Live Footer Status For Swarm Activity
- Story 5: Progress Widget For Active Swarm Runs
- Story 6: Rich Swarm Tool Rendering
- Story 17: RPC And IDE Client Feedback

### Milestone 3: Real Coordination Patterns

- Story 8: Parallel Fan-Out Mode
- Story 9: Sequential Chain Mode
- Story 11: Structured Handoffs Between Agents
- Story 12: Budget And Concurrency Controls

### Milestone 4: Safe Editing Swarms

- Story 13: Approval Gates For Risky Swarm Actions
- Story 14: Worktree Isolation Per Worker
- Story 15: Synthesizer And Mergeback Workflow
- Story 16: Abort, Retry, And Resume Controls

### Milestone 5: Planner-Driven Swarms And Hardening

- Story 10: Planner-Generated Task Graphs
- Story 18: Swarm Evaluation And Test Harness

## Recommended Implementation Order

1. Wrap the existing subagent example into a Pi-native swarm extension with stable run records.
2. Add footer and widget feedback before increasing orchestration complexity.
3. Ship single, then parallel, then chain execution.
4. Add budgets and structured handoffs before edit-capable worker swarms.
5. Add worktree isolation and approval gates before any shared implementation workflow.
6. Add planner-generated task graphs only after the manual orchestration surface is trustworthy.
7. Finish with RPC parity and regression coverage.

## UI Feedback Strategy

### Always-On Feedback

- Footer status for global run state.
- Widget for active run overview.
- Tool row rendering for per-run detail.

### On-Demand Feedback

- `/swarm inspect <run>` for full run detail.
- `/swarm runs` for recent history.
- Expandable tool results for logs, artifacts, and usage.

### Failure Feedback

- Failed tasks should stay visible until dismissed or replaced by a retry.
- Partial runs should show exactly which tasks succeeded, failed, or were skipped.
- Approval blocks should render as blocked state, not as silent inactivity.

## Key Risks

- Parallel edits without worktree isolation will create confusing races.
- Dynamic planner-generated swarms can become opaque before the manual model is mature.
- UI feedback can become noisy if every worker streams raw logs at once.
- RPC clients may lag behind TUI capabilities if the state model is not kept simple.

## Out Of Scope For The First Swarm Iteration

- Fully autonomous self-spawning recursive swarms
- Arbitrary DAG scheduling with speculative execution
- Automatic conflict resolution across overlapping worker edits
- Cross-machine or remote-worker orchestration
