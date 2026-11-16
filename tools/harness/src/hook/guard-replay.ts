// The guard replay: lists the recorded calls that one rule refused under its old version and
// allows under its new one. It reads session transcripts and never the ledger, and it writes
// nothing. The two evaluators, the transcripts and the context are injected, so the core is pure.
// Checklist and usage: the `replay` entry of the guardrail domain (cli/guardrail-replay-commands.ts).

import type { GuardContext, Verdict } from "./guard-verdict.js";
import { blocksOf, type Transcript } from "./retro-transcript.js";

/** Decides one tool call, as `evaluate` in guard-evaluate.ts does. */
export type Evaluate = (
  payload: unknown,
  ctx: GuardContext,
) => Promise<Verdict>;

/** The tools the guard's rules read: a shell command, or a file path. */
const REPLAYED_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "Read",
  "Write",
  "Edit",
]);

/** A window of instants, in epoch ms: a call starting at `since` or later and before `until`. */
export interface Window {
  since: number;
  until: number;
}

/** One recorded call a guard rule can decide: where it was written and what it ran. */
export interface WindowCall {
  session: string;
  line: number;
  at: string;
  cwd: string;
  tool: string;
  input: Record<string, unknown>;
}

/** A call the old rule refused and the new one allows. */
export interface Changed {
  session: string;
  line: number;
  at: string;
  tool: string;
  /** The command, for a Bash call. */
  command?: string;
  /** The file path, for a file call. */
  path?: string;
}

export interface ReplayReport {
  rule: string;
  /** How many recorded calls were evaluated under both versions. */
  examined: number;
  /** True when no call changed; the report states an empty list as empty. */
  empty: boolean;
  changed: Changed[];
}

export interface ReplayInput {
  rule: string;
  calls: readonly WindowCall[];
  before: Evaluate;
  after: Evaluate;
  contextOf: (cwd: string) => GuardContext;
}

/**
 * The recorded Bash, Read, Write and Edit calls that start inside the window, in transcript
 * order. A call with no timestamp cannot be placed, so it is left out; a call run by a
 * subagent counts; a call without a recorded directory runs in the repository root.
 */
export function callsInWindow(
  transcripts: readonly Transcript[],
  window: Window,
  root: string,
): WindowCall[] {
  const calls: WindowCall[] = [];
  for (const transcript of transcripts) {
    for (const event of transcript.events) {
      const stamp = Date.parse(event.timestamp ?? "");
      if (
        event.type !== "assistant" ||
        !(stamp >= window.since && stamp < window.until)
      ) {
        continue;
      }
      for (const block of blocksOf(event)) {
        if (
          block.type !== "tool_use" ||
          !REPLAYED_TOOLS.has(block.name ?? "")
        ) {
          continue;
        }
        calls.push({
          session: transcript.id,
          line: event.line,
          at: event.timestamp ?? "",
          cwd: event.cwd ?? root,
          tool: block.name ?? "",
          input: block.input ?? {},
        });
      }
    }
  }
  return calls;
}

const textOf = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** The report's entry for one call: its command for Bash, its file path for a file tool. */
function entryOf(call: WindowCall): Changed {
  const where = {
    session: call.session,
    line: call.line,
    at: call.at,
    tool: call.tool,
  };
  return call.tool === "Bash"
    ? { ...where, command: textOf(call.input["command"]) }
    : { ...where, path: textOf(call.input["file_path"]) };
}

/**
 * Evaluates every call under both versions and lists the calls the old version refused under
 * `rule` and the new version does not block. A warning counts as allowed; a refusal by another
 * rule does not count as the rule refusing the call.
 */
export async function replayRule({
  rule,
  calls,
  before,
  after,
  contextOf,
}: ReplayInput): Promise<ReplayReport> {
  const changed: Changed[] = [];
  for (const call of calls) {
    const payload = {
      session_id: call.session,
      tool_name: call.tool,
      tool_input: call.input,
      cwd: call.cwd,
    };
    const ctx = contextOf(call.cwd);
    const refused = await before(payload, ctx);
    const next = await after(payload, ctx);
    const wasRefusedByRule =
      refused.action === "block" && refused.rule === rule;
    if (wasRefusedByRule && next.action !== "block") {
      changed.push(entryOf(call));
    }
  }
  return {
    rule,
    examined: calls.length,
    empty: changed.length === 0,
    changed,
  };
}
