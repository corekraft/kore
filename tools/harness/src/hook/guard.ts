// PreToolUse guard: enforces mechanically checkable rules from AGENTS.md.
// Plan: infra/plans/3-agent-harness.md (Step 2).
//
// Contract: reads the tool call as JSON on stdin. Exit 2 with the reason on
// stderr blocks the call. A warning is returned as additionalContext. Malformed
// input fails open, because a broken guard must not stop all work.
import { evaluateBash } from "./guard-bash.js";
import { evaluateFile } from "./guard-file.js";
import { allow, type GuardContext, type Verdict } from "./guard-verdict.js";
import type { Call } from "./feedback.js";
import { recordEvent } from "./ledger-event.js";
import type { CliDeps } from "../runtime/index.js";
import type { HookResult } from "./io.js";

interface GuardCall extends Call {
  tool_input?: Record<string, unknown> & { file_path?: unknown };
}

const asCall = (payload: unknown): GuardCall =>
  typeof payload === "object" && payload !== null ? (payload as GuardCall) : {};

/** Decide on one tool call. */
export async function evaluate(
  payload: unknown,
  ctx: GuardContext,
): Promise<Verdict> {
  const call = asCall(payload);
  const tool = call.tool_name;
  const input = call.tool_input ?? {};

  if (tool === "Bash" && typeof input["command"] === "string") {
    return await evaluateBash(input["command"], ctx);
  }

  const filePath = input.file_path;
  if (
    (tool === "Read" || tool === "Write" || tool === "Edit") &&
    typeof filePath === "string"
  ) {
    const prefix = `${ctx.root}/`;
    const relative = filePath.startsWith(prefix)
      ? filePath.slice(prefix.length)
      : filePath;
    return await evaluateFile(tool, input, relative, ctx);
  }

  return allow;
}

/** Runs the guard against the payload the host sent; a block exits 2. */
export async function guard(
  payload: unknown,
  deps: CliDeps,
): Promise<HookResult> {
  if (payload === undefined) {
    return {};
  }
  const call = asCall(payload);
  const root =
    deps.env["CLAUDE_PROJECT_DIR"] ||
    (typeof call.cwd === "string" && call.cwd !== "" ? call.cwd : deps.cwd);
  // Recording runs beside the rules, so resolving the ledger root never adds to the guard's latency.
  const started = recordEvent(deps, "tool.start", call);
  const verdict = await evaluate(payload, {
    root,
    readFile: (path) => deps.fs.readFile(path),
  });
  await started;

  if (verdict.action === "block") {
    // A blocked call never reaches the post-tool hook, so close its start here.
    await recordEvent(deps, "tool.end", call, "failure");
    return { code: 2, stderr: `${verdict.message}\n` };
  }
  if (verdict.action === "warn") {
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: verdict.message,
        },
      }),
    };
  }
  return {};
}
