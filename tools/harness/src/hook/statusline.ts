// `harness hook statusline`: context use, the active plan, its Next: step and
// open items on one line, so the human sees when to start a new thread. It
// reads plans through the shared plan parser, so it agrees with the session
// brief on the active plan and on `Next:`.
// Plan: infra/plans/3-agent-harness.md (Step 9). Opt-in from user settings, not
// registered in .claude/settings.json: a project status line replaces each
// person's own.

import { activePlans, nextStep, openCounts, readPlans } from "../plan/index.js";
import { hookCommand } from "./io.js";

const AMBER_AT = 40;
const RED_AT = 50;

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface StatusInput {
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
    const line = statusLine(payload as StatusInput, await readPlans(deps));
    return line === "" ? {} : { stdout: `${line}\n` };
  },
);
