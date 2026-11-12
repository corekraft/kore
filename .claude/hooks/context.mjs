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

import { recordEvent } from "./ledger.mjs";

const PLANS_DIR = "infra/plans";
const RETRO_AFTER_SESSIONS = 5;
const RETRO_MARKER = /^\W*Last retrospective: (\d{4}-\d{2}-\d{2})/gm;
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const UPCOMING_STEPS = 3;

/** Group a Markdown list into items, joining wrapped lines. Returns [{heading, text}]. */
export function listItems(markdown) {
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

/** The newest `Last retrospective:` date across every marker in every plan, or null. */
export function lastRetrospective(plans) {
  const dates = Object.values(plans)
    .flatMap((markdown) =>
      [...markdown.matchAll(RETRO_MARKER)].map((match) => match[1]),
    )
    .sort();
  return dates.at(-1) ?? null;
}

/**
 * Where the retrospective window opens, in epoch ms: local midnight at the
 * start of the marker date (0 without one). The marker has day granularity, so
 * the window is closed on the left: a session active at or after that instant
 * is in the next retrospective. A session earlier on the marker day that the
 * retrospective already reviewed is counted again, which is preferred to
 * losing the sessions that ran later that day. Each transcript is one session,
 * so none is counted twice.
 */
export function windowStart(date) {
  return date ? new Date(`${date}T00:00:00`).getTime() : 0;
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

const JOURNAL_DIR = ".kore/state/journal";

/** The latest operation in a journal: {op, command, ts, outcome, error}; outcome is null when interrupted. */
export function lastOperation(entries) {
  const start = entries.findLast((entry) => entry?.kind === "start");
  if (!start) return null;
  const end = entries.findLast(
    (entry) => entry?.kind === "end" && entry.op === start.op,
  );
  return {
    op: start.op,
    command: start.command,
    ts: start.ts,
    outcome: end?.outcome ?? null,
    error: end?.error,
  };
}

/** One line per environment journal: the last operation, its outcome, and its date. */
export function environmentLines(journals) {
  const lines = [];
  for (const environment of Object.keys(journals).sort()) {
    const last = lastOperation(journals[environment]);
    if (!last) continue;
    const date = String(last.ts).slice(0, 10);
    const label = `Environment ${environment}: last operation \`${last.command}\``;
    if (last.outcome === null) {
      lines.push(
        `${label} was interrupted (started ${date}, no end recorded).`,
      );
    } else if (last.outcome === "failed") {
      lines.push(
        `${label} failed on ${date}${last.error ? `: ${last.error}` : ""}.`,
      );
    } else {
      lines.push(`${label} ${last.outcome} on ${date}.`);
    }
  }
  return lines;
}

/** A few lines for a fresh session: active plans, Next: lines, upcoming steps, environments, retrospective due. */
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
  lines.push(...environmentLines(deps.readJournals?.() ?? {}));
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

/** Parsed entries per environment from the journal files under root; malformed lines are skipped. */
export function readJournals(root) {
  const dir = join(root, JOURNAL_DIR);
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  const journals = {};
  for (const name of names) {
    let text;
    try {
      text = readFileSync(join(dir, name), "utf8");
    } catch {
      continue; // An unreadable entry must not lose the rest of the brief.
    }
    const entries = [];
    for (const line of text.split("\n")) {
      try {
        const entry = JSON.parse(line);
        if (entry && typeof entry === "object") entries.push(entry);
      } catch {
        // A torn or foreign line is not worth failing the brief.
      }
    }
    journals[name.slice(0, -".jsonl".length)] = entries;
  }
  return journals;
}

function realDeps(root) {
  return {
    readJournals: () => readJournals(root),
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
      const after = windowStart(date);
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
  recordEvent("session.start", event, { root });
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
