// Records Claude session and tool events in the stage ledger through the
// harness bundle: `harness.mjs ledger record`. Shared by the session, tool and
// stop hooks. Plan: infra/plans/8-harness-measurement.md#step-3-stage-event-ledger
// Node standard library only.
//
// Contract: never throws and never waits. The recorder runs detached with
// ignored output, so a missing bundle, a bad path or a rejected event cannot
// change a hook's verdict, stdout or exit code. Only the session id, the Herdr
// pane id and the tool name are passed on; prompts and tool input or output
// never reach the command line.

import { spawn as nodeSpawn } from "node:child_process";
import { join } from "node:path";

const BUNDLE = join("skills", "bin", "harness.mjs");

/**
 * Append one Claude event to the ledger.
 * @param kind a ledger kind: session.start, session.stop, tool.start or tool.end
 * @param call the hook payload as parsed JSON
 * @param deps root (project directory), env, and optionally spawn, now, outcome
 */
export function recordEvent(kind, call, deps) {
  try {
    const session = call?.session_id;
    if (typeof session !== "string" || session === "") return;
    const {
      root,
      env = process.env,
      spawn = nodeSpawn,
      now = () => new Date(),
      outcome,
    } = deps;
    const args = [
      join(root, BUNDLE),
      "ledger",
      "record",
      "--source",
      "claude",
      "--kind",
      kind,
      "--occurred-at",
      now().toISOString(),
      "--session",
      session,
    ];
    const pane = env.HERDR_PANE_ID;
    if (typeof pane === "string" && pane !== "") args.push("--pane", pane);
    if (kind.startsWith("tool.") && typeof call.tool_name === "string") {
      args.push("--tool", call.tool_name);
    }
    if (outcome !== undefined) args.push("--outcome", outcome);
    const child = spawn(process.execPath, args, {
      cwd: root,
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Recording is best effort by contract.
  }
}
