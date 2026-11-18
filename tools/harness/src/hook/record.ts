// `harness hook record session-start`: records a session start in the stage
// ledger and prints nothing. A session starts on startup, clear or resume; a
// compaction continues the same session, so it is not a start. Each start also
// polls GitHub and herdr into the ledger in the background (best effort). A compact start
// records a session.compacted reading instead, once per compaction (#1037). The context
// hook keeps its own matcher and output and does not record.
// Plan: infra/plans/8-harness-measurement.md#step-3-stage-event-ledger

import { fileURLToPath } from "node:url";
import type { CliDeps } from "../runtime/index.js";
import { recordCompaction } from "./compaction.js";
import { hookCommand } from "./io.js";
import { recordEvent } from "./ledger-event.js";
import { asksOwner } from "./owner-question.js";

const STARTS = new Set(["startup", "clear", "resume"]);

/**
 * The ledger polls a session start runs in the background: GitHub's outcome
 * signals and herdr's pane states (`pane.stalled` among them, #1091). The herdr
 * poll only reads herdr and writes ledger events; it never closes, restarts or
 * messages a pane.
 */
const BACKGROUND_POLLS = ["poll-github", "poll-herdr"] as const;

/**
 * Starts each `ledger poll` detached (its own process group, no pipes,
 * unref'd), so the hook exits at once whatever the polls do: the ledger gets
 * its signals without a session start ever waiting on GitHub or herdr. Each
 * poll is started on its own, so one that cannot start does not stop the next.
 * Best effort by contract: a poll that fails, is rate limited or cannot start
 * never changes the hook's output, and its output is dropped, never printed.
 * Each poll refuses to run twice at once (ledger/poll-lock.ts, a lock file
 * beside the ledger, taken in ledger/github-poll.ts and ledger/herdr-poll.ts).
 */
function pollInBackground(deps: CliDeps): void {
  if (deps.bundleUrl === undefined) {
    return;
  }
  for (const poll of BACKGROUND_POLLS) {
    try {
      deps.runner
        .run("node", [fileURLToPath(deps.bundleUrl), "ledger", poll], {
          detached: true,
        })
        .catch(() => undefined);
    } catch {
      // Best effort: a poll is not the hook's verdict.
    }
  }
}

/**
 * Whether the turn that just ended left its final message asking the owner. The
 * transcript is read here and its text is not kept; an unreadable transcript
 * counts as no question.
 */
async function endedAskingOwner(
  deps: CliDeps,
  transcriptPath: unknown,
): Promise<boolean> {
  if (typeof transcriptPath !== "string") {
    return false;
  }
  try {
    return asksOwner(await deps.fs.readFile(transcriptPath));
  } catch {
    // An unreadable transcript is no question: the hook records what it can read.
    return false;
  }
}

export const record = hookCommand(
  "record",
  "record a ledger event for the session; modes: session-start (SessionStart, no matcher; a startup, clear or resume start records session.start and starts ledger poll-github and ledger poll-herdr in the background; a compact start records one session.compacted reading, the compaction's number, once per compaction), turn-end (Stop; records owner.asked when the final message asks the owner), owner-asked (PreToolUse on AskUserQuestion; records owner.asked)",
  async ({ deps, payload, operand }) => {
    if (typeof payload !== "object" || payload === null) {
      return {};
    }
    const call = payload as {
      source?: unknown;
      session_id?: unknown;
      tool_name?: unknown;
      transcript_path?: unknown;
    };
    if (
      operand === "session-start" &&
      typeof call.source === "string" &&
      STARTS.has(call.source)
    ) {
      await recordEvent(deps, "session.start", call);
      pollInBackground(deps);
    }
    if (operand === "session-start" && call.source === "compact") {
      await recordCompaction(deps, call);
    }
    if (
      operand === "turn-end" &&
      (await endedAskingOwner(deps, call.transcript_path))
    ) {
      await recordEvent(deps, "owner.asked", call);
    }
    if (operand === "owner-asked" && call.tool_name === "AskUserQuestion") {
      await recordEvent(deps, "owner.asked", call);
    }
    return {};
  },
  { operand: "mode" },
);
