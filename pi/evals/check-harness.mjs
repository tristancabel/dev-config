#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const root = resolve(new URL("../..", import.meta.url).pathname);
const failures = [];

function check(name, condition, detail = "") {
  if (condition) return;
  failures.push(detail ? `${name}: ${detail}` : name);
}

function compileRules(label, rules) {
  for (const rule of rules ?? []) {
    try {
      new RegExp(rule.command);
    } catch (error) {
      failures.push(`${label} rule does not compile: ${rule.command} (${error.message})`);
    }
  }
}

const settings = readJson(resolve(root, "pi/agent/settings.json"));
const profiles = readJson(resolve(root, "pi/agent/profiles.json"));
const guardrails = readJson(resolve(root, "pi/guardrails.json"));
const suite = readJson(resolve(root, "pi/evals/model-comparison.json"));
const subagents = readJson(resolve(root, "pi/subagents.capabilities.json"));
const personaSource = readFileSync(resolve(root, "pi/agent/extensions/persona.ts"), "utf8");
const runtimeSource = readFileSync(resolve(root, "pi/agent/extensions/runtime.ts"), "utf8");

const packageSet = new Set(settings.packages ?? []);
for (const required of ["npm:@aliou/pi-guardrails", "npm:pi-subagents", "npm:@juicesharp/rpiv-ask-user-question"]) {
  check(`required package ${required}`, packageSet.has(required));
}

const expectedModes = {
  conversation: "read-only",
  scout: "read-only",
  "dev-planner": "read-only",
  builder: "edit-allowed",
  reviewer: "review-runner",
  verifier: "review-runner",
};

for (const [name, mode] of Object.entries(expectedModes)) {
  check(`${name} profile exists`, Boolean(profiles.profiles?.[name]));
  check(`${name} permission mode`, profiles.profiles?.[name]?.permissionMode === mode, `expected ${mode}`);
}

compileRules("deny", guardrails.deny);
compileRules("confirm", guardrails.confirm);

const denyRules = (guardrails.deny ?? []).map((rule) => new RegExp(rule.command));
for (const command of ["sudo whoami", "pip install requests", "python -m pip install requests", "rm -rf /"]) {
  check(`guardrail denies ${command}`, denyRules.some((rule) => rule.test(command)));
}

check("model comparison suite has scenarios", Array.isArray(suite.scenarios) && suite.scenarios.length >= 6);
for (const scenario of suite.scenarios ?? []) {
  check(`scenario ${scenario.id} has persona`, typeof scenario.persona === "string" && scenario.persona.length > 0);
  check(`scenario ${scenario.id} has prompt`, typeof scenario.prompt === "string" && scenario.prompt.length > 0);
  check(`scenario ${scenario.id} has transcript checks`, Boolean(scenario.transcriptChecks));
}

for (const agent of ["scout", "researcher", "oracle", "reviewer", "worker", "delegate"]) {
  check(`subagent policy includes ${agent}`, Boolean(subagents.agents?.[agent]));
}
check("subagent policy denies parallel editing", subagents.default?.parallelEditing === "deny");
check("worker is bounded editing agent", subagents.agents?.worker?.mayEditFiles === true);
check("reviewer is read-only", subagents.agents?.reviewer?.mayEditFiles === false);

for (const marker of [
  'DEFAULT_BUILDER_DELEGATION_MODE: BuilderDelegationMode = "off"',
  "ACCEPTANCE_LINE_PATTERN",
  "REVIEW_LINE_PATTERN",
  "VERDICT_LINE_PATTERN",
  "getMissingPlanSections",
  "SUBAGENT_CAPABILITY_POLICY",
  "subagent-runs",
]) {
  check(`persona workflow marker ${marker}`, personaSource.includes(marker));
}

for (const marker of ["STOP_INPUT_PATTERN", "requestAgentStop", "ctx.abort()"]) {
  check(`runtime stop marker ${marker}`, runtimeSource.includes(marker));
}

if (failures.length > 0) {
  console.error("Pi harness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Pi harness check passed.");
