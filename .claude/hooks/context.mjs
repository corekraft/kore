#!/usr/bin/env node
// SessionStart hook: after compaction, restates the AGENTS.md rules and the
// active plan's open items, since compaction may drop them.
// Plan: infra/plans/3-agent-harness.md (Step 8). Node standard library only.
//
// Contract: reads the SessionStart event as JSON on stdin and returns context as
// additionalContext. Silent on any start other than "compact". Fails open.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLANS_DIR = "infra/plans";

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

/** Every AGENTS.md rule, with its enforcement markers kept. */
export function rules(agentsMarkdown) {
  return listItems(agentsMarkdown).map((item) => item.text);
}

/** Unchecked plan items, each prefixed with the step heading it belongs to. */
export function openItems(planMarkdown) {
  return listItems(planMarkdown)
    .filter((item) => item.text.startsWith("- [ ]"))
    .map((item) => `${item.heading}: ${item.text}`);
}

/** The highest-numbered plan file that still has open items, or null. */
export function activePlan(plans) {
  const names = Object.keys(plans).sort(
    (a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10),
  );
  return names.find((name) => openItems(plans[name]).length > 0) ?? null;
}

/** The context to restore for a SessionStart event; empty unless it follows compaction. */
export function restore(event, deps) {
  if (event?.source !== "compact") return "";
  const sections = [
    "Context was compacted. Keep applying these AGENTS.md rules; hooks check only the parts marked Enforced or Audited:",
    ...rules(deps.readAgents()),
  ];
  const plans = deps.readPlans();
  const plan = activePlan(plans);
  if (plan) {
    sections.push(
      "",
      `Open plan items in ${PLANS_DIR}/${plan}:`,
      ...openItems(plans[plan]),
    );
  }
  return sections.join("\n");
}

function realDeps(root) {
  return {
    readAgents: () => readFileSync(join(root, "AGENTS.md"), "utf8"),
    readPlans: () => {
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
    },
  };
}

function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  if (typeof event !== "object" || event === null || Array.isArray(event))
    return 0;
  const root = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd();
  let context;
  try {
    context = restore(event, realDeps(root));
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  if (context) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: context,
        },
      }),
    );
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}
