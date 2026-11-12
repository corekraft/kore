#!/usr/bin/env node
// Status line: context use, the active plan, its Next: step, and open items, so
// the human sees when to start a new thread without tracking it.
// Plan: infra/plans/3-agent-harness.md (Step 9). Node standard library only.
//
// Contract: reads the status line JSON on stdin and prints one line. Context use
// turns amber at 40% and red at 50%. Prints nothing it cannot know. Fails open.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLANS_DIR = "infra/plans";

// The plan reading this line needs, kept here until it moves to the harness
// (#182); the context hook now reads plans through the harness plan parser.

/** Group a Markdown list into items, joining wrapped lines. Returns [{heading, text}]. */
function listItems(markdown) {
  const items = [];
  let heading = "";
  let current = null;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) heading = line.slice(3).trim();
    if (line.startsWith("- ")) {
      current = { heading, text: line.trim() };
      items.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`;
    } else {
      current = null;
    }
  }
  return items;
}

/** Unchecked plan items, each prefixed with the step heading it belongs to. */
function openItems(planMarkdown) {
  return listItems(planMarkdown)
    .filter((item) => item.text.startsWith("- [ ]"))
    .map((item) => `${item.heading}: ${item.text}`);
}

/** The highest-numbered plan file that still has open items, or null. */
function activePlan(plans) {
  const names = Object.keys(plans).sort(
    (a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10),
  );
  return names.find((name) => openItems(plans[name]).length > 0) ?? null;
}

/** The plan's `Next:` line and the step it sits under, or null. */
function nextStep(planMarkdown) {
  let heading = "";
  let next = null;
  for (const line of planMarkdown.split("\n")) {
    if (next) {
      if (!line.trim() || line.startsWith("#")) break;
      next.text += ` ${line.trim()}`;
    } else if (line.startsWith("## ")) {
      heading = line.slice(3).trim();
    } else if (line.startsWith("Next:")) {
      next = { step: heading, text: line.slice(5).trim() };
    }
  }
  return next;
}

/** Every plan under root, keyed by file name; empty when there is no plans directory. */
function readPlans(root) {
  const dir = join(root, PLANS_DIR);
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  return Object.fromEntries(
    names.map((name) => [name, readFileSync(join(dir, name), "utf8")]),
  );
}

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
