# Pi Harness Evals

This directory contains lightweight checks for comparing model routes on Pi harness behavior.

## Static Harness Check

Run this after changing Pi config or extensions:

```bash
node pi/evals/check-harness.mjs
```

It checks the local harness contract: role permission modes, required safety plugins, guardrail regexes, model-comparison scenarios, subagent capability policy, and workflow-enforcement markers in `persona.ts`.

## Model Comparison Pack

`model-comparison.json` is a scenario suite for comparing the current local oMLX model with other models. For each candidate model:

1. Route the relevant persona to the candidate in `.pi/models.json` or `pi/agent/models.json`.
2. Start a fresh Pi session.
3. Run each scenario prompt under its listed persona.
4. Save the model response/transcript to a file.
5. Score the transcript:

```bash
node pi/evals/score-output.mjs reviewer-final-verdict /path/to/reviewer-output.md
```

The scorer is intentionally simple. It catches harness-contract failures such as missing final verdicts, missing required plan sections, or unsafe claims. Human review should still score qualitative criteria from the scenario file.

## Comparison Notes

Use the same repository state, persona, prompt, and context freshness for every model. Record:

- model route
- persona
- scenario id
- pass/fail from `score-output.mjs`
- manual 0-2 score per criterion
- notable drift, hallucinated tool use, missed guardrails, or excessive verbosity
