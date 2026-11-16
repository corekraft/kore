// The guard replay core: lists the recorded calls that one rule refused under an old ref and
// allows under a new one. Each ref's verdict comes from a judge injected here (guard-judge.ts runs
// the ref's own built guard), so the core is pure: it reads the transcripts it is given and writes
// nothing.

import { blocksOf, type Transcript } from "./retro-transcript.js";

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

/** A ref's verdict on one call: allowed, warned about, or refused by a named rule. */
export type Judged =
  | { action: "allow" }
  | { action: "warn"; rule: string }
  | { action: "block"; rule: string };

/** Decides one recorded call under one ref. */
export type Judge = (call: WindowCall) => Promise<Judged>;

/** A call the old ref refused under the rule and the new ref allows. */
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
  /** How many recorded calls were judged under both refs. */
  examined: number;
  /** True when no call changed; the report states an empty list as empty. */
  empty: boolean;
  changed: Changed[];
}

export interface ReplayInput {
  rule: string;
  calls: readonly WindowCall[];
  before: Judge;
  after: Judge;
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

/** A judge that asks the wrapped judge once per distinct call: the same call is the same verdict. */
function onceEach(judge: Judge): Judge {
  const seen = new Map<string, Promise<Judged>>();
  return (call) => {
    const key = JSON.stringify([call.tool, call.cwd, call.input]);
    let verdict = seen.get(key);
    if (verdict === undefined) {
      verdict = judge(call);
      seen.set(key, verdict);
    }
    return verdict;
  };
}

/**
 * Judges every call under both refs and lists the calls the old ref refused under `rule` and
 * the new ref does not block. A warning counts as allowed; a refusal by another rule does not
 * count as the rule refusing the call.
 */
export async function replayRule({
  rule,
  calls,
  before,
  after,
}: ReplayInput): Promise<ReplayReport> {
  const judgeBefore = onceEach(before);
  const judgeAfter = onceEach(after);
  const changed: Changed[] = [];
  for (const call of calls) {
    const refused = await judgeBefore(call);
    const allowed = await judgeAfter(call);
    const wasRefusedByRule =
      refused.action === "block" && refused.rule === rule;
    if (wasRefusedByRule && allowed.action !== "block") {
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
