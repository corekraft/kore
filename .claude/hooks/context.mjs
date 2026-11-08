#!/usr/bin/env node
// SessionStart hook. After compaction it restates the AGENTS.md rules and the
// active plans' open items, since compaction may drop them (Step 8). On a fresh
// session or /clear it prints a short brief: where each active plan stands, its
// Next: line and upcoming steps, and whether a retrospective is due (Step 9).
// Plan: infra/plans/3-agent-harness.md. Node standard library only.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context
//
// Contract: reads the SessionStart event as JSON on stdin and returns context as
// additionalContext. Silent on resume. Fails open.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PLANS_DIR = "infra/plans";
const RETRO_AFTER_SESSIONS = 5;
const RETRO_MARKER = /^\W*Last retrospective: (\d{4}-\d{2}-\d{2})/m;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const UPCOMING_STEPS = 3;

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

/**
 * Every plan the brief should cover, highest-numbered first: each plan whose
 * frontmatter says `status: active`, plus the highest-numbered plan without
 * frontmatter that still has open items.
 */
export function activePlans(plans) {
  const withoutFrontmatter = {};
  const active = [];
  for (const [name, markdown] of Object.entries(plans)) {
    const frontmatter = FRONTMATTER.exec(markdown)?.[1];
    if (frontmatter === undefined) withoutFrontmatter[name] = markdown;
    else if (/^status: *active *$/m.test(frontmatter)) active.push(name);
  }
  const legacy = activePlan(withoutFrontmatter);
  if (legacy) active.push(legacy);
  return active.sort((a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10));
}

/** The plan's `Next:` line and the step it sits under, or null. */
export function nextStep(planMarkdown) {
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

/** The latest `Last retrospective:` date across all plans, or null. */
export function lastRetrospective(plans) {
  const dates = Object.values(plans)
    .map((markdown) => RETRO_MARKER.exec(markdown)?.[1])
    .filter(Boolean)
    .sort();
  return dates.at(-1) ?? null;
}

/** Open item counts per step heading, in plan order. */
function openSteps(planMarkdown) {
  const counts = new Map();
  for (const item of listItems(planMarkdown)) {
    if (!item.text.startsWith("- [ ]")) continue;
    counts.set(item.heading, (counts.get(item.heading) ?? 0) + 1);
  }
  return counts;
}

/** Open item counts per step, in plan order: "Step 3 (2), Step 4 (1)". */
function openCounts(planMarkdown) {
  return [...openSteps(planMarkdown)]
    .map(([heading, count]) => `${heading.split(":")[0]} (${count})`)
    .join(", ");
}

/**
 * Titles of the next steps with open items after the current one: the step
 * holding the `Next:` line, or else the first step with open items.
 */
export function upcomingSteps(planMarkdown) {
  const open = [...openSteps(planMarkdown).keys()];
  const current = nextStep(planMarkdown)?.step ?? open[0];
  const headings = planMarkdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
  const after = headings.slice(headings.indexOf(current) + 1);
  return after
    .filter((heading) => open.includes(heading))
    .slice(0, UPCOMING_STEPS);
}

/** A few lines for a fresh session: active plans, Next: lines, upcoming steps, retrospective due. */
export function brief(event, deps) {
  const plans = deps.readPlans();
  const lines = [];
  for (const plan of activePlans(plans)) {
    lines.push(`Session brief from ${PLANS_DIR}/${plan}:`);
    const counts = openCounts(plans[plan]);
    if (counts) lines.push(`Open items: ${counts}.`);
    const next = nextStep(plans[plan]);
    if (next) lines.push(`Next (${next.step}): ${next.text}`);
    const upcoming = upcomingSteps(plans[plan]);
    if (upcoming.length > 0) lines.push(`Upcoming: ${upcoming.join("; ")}.`);
  }
  const since = lastRetrospective(plans);
  const sessions = deps.sessionsSince(since, event?.session_id);
  if (sessions >= RETRO_AFTER_SESSIONS) {
    lines.push(
      since
        ? `${sessions} sessions since the last retrospective (${since}); run /retro.`
        : `${sessions} sessions without a recorded retrospective; run /retro.`,
    );
  }
  return lines.join("\n");
}

/** The context for a SessionStart event: the brief on a fresh start, the rules after compaction. */
export function restore(event, deps) {
  if (event?.source === "startup" || event?.source === "clear") {
    return brief(event, deps);
  }
  if (event?.source !== "compact") return "";
  const sections = [
    "Context was compacted. Keep applying these AGENTS.md rules; hooks check only the parts marked Enforced or Audited:",
    ...rules(deps.readAgents()),
  ];
  const plans = deps.readPlans();
  for (const plan of activePlans(plans)) {
    sections.push(
      "",
      `Open plan items in ${PLANS_DIR}/${plan}:`,
      ...openItems(plans[plan]),
    );
  }
  return sections.join("\n");
}

/** Every plan under root, keyed by file name; empty when there is no plans directory. */
export function readPlans(root) {
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

function realDeps(root) {
  return {
    readAgents: () => readFileSync(join(root, "AGENTS.md"), "utf8"),
    readPlans: () => readPlans(root),
    sessionsSince: (date, current) => {
      const config =
        process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
      const dir = join(config, "projects", root.replace(/[^a-zA-Z0-9]/g, "-"));
      let names;
      try {
        names = readdirSync(dir);
      } catch (error) {
        if (error?.code === "ENOENT") return 0;
        throw error;
      }
      // The marker is a local date and the retrospective ran during it, so
      // count only sessions active after that day ends.
      const after = date
        ? new Date(`${date}T00:00:00`).getTime() + 24 * 60 * 60 * 1000
        : 0;
      return names.filter(
        (name) =>
          name.endsWith(".jsonl") &&
          name !== `${current}.jsonl` &&
          statSync(join(dir, name)).mtimeMs >= after,
      ).length;
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
