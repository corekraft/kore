// PreToolUse guard: enforces mechanically checkable rules from AGENTS.md.
// Plan: infra/plans/3-agent-harness.md (Step 2).
//
// Contract: reads the tool call as JSON on stdin. Exit 2 with the reason on
// stderr blocks the call. A warning is returned as additionalContext. Malformed
// input fails open, because a broken guard must not stop all work.
//
// The root is CLAUDE_PROJECT_DIR, else the payload's cwd. The guardrail
// inventory (.claude/guardrails.yaml) is found from that root, walking up
// through its parents when the root is a subdirectory of the repository.
import { evaluateBash } from "./guard-bash.js";
import { evaluateFile } from "./guard-file.js";
import { checkRole } from "./guard-role.js";
import { allow, type GuardContext, type Verdict } from "./guard-verdict.js";
import {
  GuardrailError,
  modeOf,
  findInventory,
  type Inventory,
} from "../guardrail/index.js";
import type { Call } from "./feedback.js";
import { recordEvent } from "./ledger-event.js";
import type { CliDeps } from "../runtime/index.js";
import type { HookResult } from "./io.js";

interface GuardCall extends Call {
  agent_type?: unknown;
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

  const bounded =
    typeof tool === "string"
      ? checkRole(call.agent_type, tool, input, ctx.root)
      : null;
  if (bounded !== null) {
    return bounded;
  }

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
  const readFile = (path: string) => deps.fs.readFile(path);
  // Fail closed: with no usable inventory every rule enforces, and the cause is named.
  let inventory: Inventory | undefined;
  let problem = "";
  try {
    inventory = await findInventory(readFile, root);
  } catch (error) {
    if (!(error instanceof GuardrailError)) {
      throw error;
    }
    problem = `\n[guard] Every rule is enforcing because ${error.message}`;
  }
  const verdict = await evaluate(payload, {
    root,
    readFile,
    modeOf: (rule) => (inventory ? modeOf(inventory, rule) : "enforce"),
  });
  await started;

  if (verdict.action === "block") {
    // A blocked call never reaches the post-tool hook, so close its start here.
    await recordEvent(deps, "tool.end", call, "failure");
    return { code: 2, stderr: `${verdict.message}${problem}\n` };
  }
  if (verdict.action === "warn") {
    // A warning is an audit-mode rule firing; the ledger counts it for the retro.
    await recordEvent(deps, "guard.audit", call, undefined, {
      label: verdict.rule,
    });
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
