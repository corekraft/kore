// `harness hook record session-start`: records a session start in the stage
// ledger and prints nothing. A session starts on startup, clear or resume; a
// compaction continues the same session, so it is not a start. Each start also
// polls GitHub into the ledger in the background (best effort). The context
// hook keeps its own matcher and output and does not record.
// Plan: infra/plans/8-harness-measurement.md#step-3-stage-event-ledger

import { fileURLToPath } from "node:url";
import type { CliDeps } from "../runtime/index.js";
import { hookCommand } from "./io.js";
import { recordEvent } from "./ledger-event.js";
import { asksOwner } from "./owner-question.js";

const STARTS = new Set(["startup", "clear", "resume"]);

/**
 * Starts `ledger poll-github` detached (its own process group, no pipes,
 * unref'd), so the hook exits at once whatever the poll does: the ledger gets
 * its outcome signals without a session start ever waiting on GitHub. Best
 * effort by contract: a poll that fails, is rate limited or cannot start never
 * changes the hook's output, and its output is dropped, never printed. The
 * poll itself refuses to run twice at once (ledger/poll-lock.ts, a lock file
 * beside the ledger, taken in ledger/github-poll.ts).
 */
function pollInBackground(deps: CliDeps): void {
  if (deps.bundleUrl === undefined) {
    return;
  }
  try {
    deps.runner
      .run("node", [fileURLToPath(deps.bundleUrl), "ledger", "poll-github"], {
        detached: true,
      })
      .catch(() => undefined);
  } catch {
    // Best effort: the poll is not the hook's verdict.
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
  "record a ledger event for the session; modes: session-start (SessionStart, no matcher; also starts ledger poll-github in the background), turn-end (Stop; records owner.asked when the final message asks the owner), owner-asked (PreToolUse on AskUserQuestion; records owner.asked)",
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
