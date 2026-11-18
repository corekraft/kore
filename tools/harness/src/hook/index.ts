import type { Command } from "../runtime/index.js";
export { checkProtected } from "./guard-role-protected.js";
export type { DeltaDeps, Snapshot } from "./delta.js";
export { checkDeliveryBash } from "./guard-role-delivery.js";
export { evaluate } from "./guard.js";
// The secret-path pattern: the decision router reuses it as a guard library entry (ADR 0120, ADR 0091).
export { SECRET_PATH } from "./guard-secrets.js";
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
// The guard replay: the calls a rule's change allows, judged by each ref's own built guard.
export {
  callsInWindow,
  replayRule,
  type Judge,
  type Judged,
  type ReplayReport,
  type Window,
  type WindowCall,
} from "./guard-replay.js";
export { GuardJudgeError, judgeWith, type ReplayPaths } from "./guard-judge.js";
export {
  closeReplayWorktree,
  openReplayWorktree,
  scrubbed,
} from "./guard-worktree.js";
export { parseTranscript } from "./retro-transcript.js";
export { defaultDirs, readTranscripts } from "./retro-transcripts.js";
// The read-only `session prompt-size` command (#1038): the split reader's latest prompt, read here
// because the transcript readers live in this domain; the host composes it into the session table.
export { promptSizeCommand } from "./prompt-size-command.js";
