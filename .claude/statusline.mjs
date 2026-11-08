#!/usr/bin/env node
// Status line: context use, the active plan, its Next: step, and open items, so
// the human sees when to start a new thread without tracking it.
// Plan: infra/plans/3-agent-harness.md (Step 9). Node standard library only.
//
// Contract: reads the status line JSON on stdin and prints one line. Context use
// turns amber at 40% and red at 50%. Prints nothing it cannot know. Fails open.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  activePlan,
  nextStep,
  openItems,
  readPlans,
} from "./hooks/context.mjs";

const AMBER_AT = 40;
const RED_AT = 50;

/** Percent of the context window in use, rounded, or null when not reported. */
export function contextPercent(input) {
  const window = input?.context_window;
  if (typeof window?.used_percentage === "number")
    return Math.round(window.used_percentage);
  const usage = window?.current_usage;
  if (!usage || !window.context_window_size) return null;
  const used =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  return Math.round((used / window.context_window_size) * 100);
}

function colored(percent) {
  const text = `ctx ${percent}%`;
  if (percent >= RED_AT) return `\x1b[31m${text}\x1b[0m`;
  if (percent >= AMBER_AT) return `\x1b[33m${text}\x1b[0m`;
  return text;
}

/** The status line for one refresh. */
export function statusLine(input, deps) {
  const parts = [];
  const percent = contextPercent(input);
  if (percent !== null) parts.push(colored(percent));
  const plans = deps.readPlans();
  const plan = activePlan(plans);
  if (plan) {
    parts.push(plan.replace(/\.md$/, ""));
    const next = nextStep(plans[plan]);
    if (next) parts.push(next.step.split(":")[0]);
    parts.push(`${openItems(plans[plan]).length} open`);
  }
  return parts.join(" · ");
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  if (typeof input !== "object" || input === null) return 0;
  const root =
    process.env.CLAUDE_PROJECT_DIR ||
    input.workspace?.project_dir ||
    input.cwd ||
    process.cwd();
  const line = statusLine(input, { readPlans: () => readPlans(root) });
  if (line) process.stdout.write(`${line}\n`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
