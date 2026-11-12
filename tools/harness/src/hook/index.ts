import type { Command } from "../runtime/index.js";
import { delta } from "./delta-command.js";
import { feedback } from "./feedback.js";
import { guard } from "./guard.js";
import { hookCommand } from "./io.js";
import { retroScan } from "./retro-hook.js";
import {
  kbCheckHook,
  skillLinks,
  workflowPermissions,
} from "./repository-checks.js";

const feedbackHook = hookCommand(
  "feedback",
  "run the post-edit, stop or tool-failure feedback checks and record ledger events",
  ({ deps, payload, operand }) => feedback(operand, payload, deps),
  { operand: "mode" },
);

const guardHook = hookCommand(
  "guard",
  "block or warn on tool calls that break mechanically checkable rules (PreToolUse)",
  ({ deps, payload }) => guard(payload, deps),
  { faultCode: 1 },
);

/** The hooks the host runs as `harness hook <name>`; each is a command in this domain. */
export const hook: Record<string, Command> = {
  delta,
  feedback: feedbackHook,
  guard: guardHook,
  "kb-check": kbCheckHook,
  "retro-scan": retroScan,
  "skill-links": skillLinks,
  "workflow-permissions": workflowPermissions,
};
