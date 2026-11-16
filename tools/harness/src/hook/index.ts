import type { Command } from "../runtime/index.js";
export { checkProtected } from "./guard-role-protected.js";
export type { DeltaDeps, Snapshot } from "./delta.js";
export { checkDeliveryBash } from "./guard-role-delivery.js";
export { evaluate } from "./guard.js";
import { feedback } from "./feedback.js";
import { guard } from "./guard.js";
import { hookCommand } from "./io.js";
import { context, delta, record, statusline } from "./session-hooks.js";
import { retroScan } from "./retro-hook.js";
import { testHooks } from "./test-hooks.js";
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
  context,
  delta,
  feedback: feedbackHook,
  guard: guardHook,
  "kb-check": kbCheckHook,
  record,
  "retro-scan": retroScan,
  "skill-links": skillLinks,
  statusline,
  ...testHooks,
  "workflow-permissions": workflowPermissions,
};
export { lastRetrospective, markerInstant } from "./retro-scan.js";
// The guard replay: a guard as it was at a ref, and the calls a rule's change allows.
export { GuardAtRefError, guardAtRef } from "./guard-at-ref.js";
export {
  callsInWindow,
  replayRule,
  type Evaluate,
  type ReplayReport,
  type Window,
} from "./guard-replay.js";
export type { GuardContext } from "./guard-verdict.js";
export { parseTranscript } from "./retro-transcript.js";
export { defaultDirs, readTranscripts } from "./retro-transcripts.js";
