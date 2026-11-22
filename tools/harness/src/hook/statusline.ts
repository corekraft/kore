// `harness hook statusline`: context use, the active plan, its Next: step and
// open items on one line, so the human sees when to start a new thread. It
// reads plans through the shared plan parser, so it agrees with the session
// brief on the active plan and on `Next:`.
// Plan: infra/plans/3-agent-harness.md (Step 9). Opt-in from user settings, not
// registered in .claude/settings.json: a project status line replaces each
// person's own.

import { activePlans, nextStep, openCounts, readPlans } from "../plan/index.js";
import type { CliDeps, CommandHelp } from "../runtime/index.js";
import { hookCommand } from "./io.js";

const AMBER_AT = 40;
const RED_AT = 50;

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface StatusInput {
  workspace?: { project_dir?: unknown };
  cwd?: unknown;
  context_window?: {
    used_percentage?: unknown;
    context_window_size?: number;
    current_usage?: Usage | null;
  };
}

/** Percent of the context window in use, rounded, or null when not reported. */
export function contextPercent(input: StatusInput): number | null {
  const window = input.context_window;
  if (typeof window?.used_percentage === "number") {
    return Math.round(window.used_percentage);
  }
  const usage = window?.current_usage;
  if (!usage || !window?.context_window_size) {
    return null;
  }
  const used =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0);
  return Math.round((used / window.context_window_size) * 100);
}

function colored(percent: number): string {
  const text = `ctx ${percent}%`;
  if (percent >= RED_AT) {
    return `\x1b[31m${text}\x1b[0m`;
  }
  if (percent >= AMBER_AT) {
    return `\x1b[33m${text}\x1b[0m`;
  }
  return text;
}

/** The status line for one refresh: what it cannot know is left out. */
export function statusLine(
  input: StatusInput,
  plans: Record<string, string>,
): string {
  const parts: string[] = [];
  const percent = contextPercent(input);
  if (percent !== null) {
    parts.push(colored(percent));
  }
  const name = activePlans(plans)[0];
  if (name !== undefined) {
    const markdown = plans[name] ?? "";
    parts.push(name.replace(/\.md$/, ""));
    const next = nextStep(markdown);
    if (next) {
      parts.push(next.step.split(":")[0] ?? next.step);
    }
    const open = openCounts(markdown).reduce((sum, c) => sum + c.count, 0);
    parts.push(`${open} open`);
  }
  return parts.join(" · ");
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * The project whose plans to read. The status line runs in every project, so
 * it never falls back to the repository the bundle sits in: the environment,
 * then the host's workspace, then its cwd.
 */
function projectOf(input: StatusInput, deps: CliDeps): string {
  return (
    text(deps.env["CLAUDE_PROJECT_DIR"]) ??
    text(input.workspace?.project_dir) ??
    text(input.cwd) ??
    deps.cwd
  );
}

/** Marker for plans that exist but cannot be read; Claude Code may hide stderr for a status line. */
const UNREADABLE = "plans?";

const statuslineHelp: CommandHelp = {
  purpose:
    "Prints one status line from the host's status-line JSON: the context window's percent in use, the active plan's name, its Next: step and its open item count. What it cannot read is left out, and a plan that cannot be read prints plans? instead.",
  when: "The host runs it as the status line when a person opts in from their user settings. It is not in this repository's settings, because a project status line would replace each person's own.",
  whenNot:
    "To read the active plan with its full text, use harness plan active.",
  flags: {
    strict: "A fault exits 1 instead of failing open with 0.",
  },
  examples: [
    {
      command: "harness hook statusline",
      shows:
        "one line with the context percent, the active plan's name, its Next: step and its open count; nothing when there is nothing to show",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the line is printed, or nothing when there is nothing to show; a fault fails open with 0 unless --strict",
    },
    { code: 1, meaning: "a fault under --strict" },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the active plans under infra/plans in the project named by CLAUDE_PROJECT_DIR, else the host's workspace, else its working directory; writes nothing",
  },
  seeAlso: ["plan active", "status"],
};

export const statusline = hookCommand(
  "statusline",
  "print one status line from the host's JSON: context use, the active plan, its Next: step and open items",
  async ({ deps, payload }) => {
    if (typeof payload !== "object" || payload === null) {
      return {};
    }
    if (Array.isArray(payload)) {
      return {};
    }
    const input = payload as StatusInput;
    const root = projectOf(input, deps);
    let line: string;
    try {
      // A project without infra/plans has no plan; readPlans already says so.
      line = statusLine(
        input,
        await readPlans({ ...deps, root: () => Promise.resolve(root) }),
      );
    } catch {
      const percent = contextPercent(input);
      line = [percent === null ? null : colored(percent), UNREADABLE]
        .filter((part) => part !== null)
        .join(" · ");
    }
    return line === "" ? {} : { stdout: `${line}\n` };
  },
  { help: statuslineHelp },
);
