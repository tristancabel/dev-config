#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const suitePath = resolve(here, "model-comparison.json");

function usage() {
  console.error("Usage: node pi/evals/score-output.mjs <scenario-id> <transcript-file>");
  process.exit(2);
}

const [scenarioId, transcriptPath] = process.argv.slice(2);
if (!scenarioId || !transcriptPath) usage();

const suite = JSON.parse(readFileSync(suitePath, "utf8"));
const scenario = suite.scenarios.find((item) => item.id === scenarioId);
if (!scenario) {
  console.error(`Unknown scenario: ${scenarioId}`);
  process.exit(2);
}

const transcript = readFileSync(transcriptPath, "utf8");
const checks = scenario.transcriptChecks ?? {};
const requireChecks = checks.require ?? [];
const forbidChecks = checks.forbid ?? [];

const required = requireChecks.map((pattern) => {
  const re = new RegExp(pattern, "im");
  return { pattern, pass: re.test(transcript) };
});

const forbidden = forbidChecks.map((pattern) => {
  const re = new RegExp(pattern, "im");
  return { pattern, pass: !re.test(transcript) };
});

const failures = [...required, ...forbidden].filter((item) => !item.pass);
const result = {
  scenario: scenario.id,
  pass: failures.length === 0,
  required,
  forbidden,
  failures,
};

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
