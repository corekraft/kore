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
import { asCall, evaluate } from "./guard-evaluate.js";
import {
  GuardrailError,
  modeOf,
  denyRules,
  findInventory,
  type Inventory,
} from "../guardrail/index.js";
import { recordEvent } from "./ledger-event.js";
import type { CliDeps } from "../runtime/index.js";
import type { HookResult } from "./io.js";

export { evaluate };

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
    denyRules: inventory ? denyRules(inventory) : [],
  });
  await started;

  if (verdict.action === "block") {
    // A blocked call never reaches the post-tool hook, so close its start here.
    await recordEvent(deps, "tool.end", call, "failure");
    // The rule name only, never the command: the flow report counts blocks per rule.
    await recordEvent(deps, "guard.block", call, undefined, {
      label: verdict.rule,
    });
    return { code: 2, stderr: `${verdict.message}${problem}\n` };
  }
  if (verdict.action === "warn") {
    // A warning is an audit-mode rule firing; the ledger counts it for the retro.
    for (const rule of verdict.rules ?? [verdict.rule]) {
      await recordEvent(deps, "guard.audit", call, undefined, { label: rule });
    }
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
