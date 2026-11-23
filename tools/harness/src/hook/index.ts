import type { Command, CommandHelp } from "../runtime/index.js";
export { checkProtected } from "./guard-role-protected.js";
export type { DeltaDeps, Snapshot } from "./delta.js";
export { checkDeliveryBash } from "./guard-role-delivery.js";
export { evaluate } from "./guard.js";
// The secret-path pattern: the decision router reuses it as a guard library entry (ADR 0120, ADR 0091).
export { SECRET_PATH } from "./guard-secrets.js";
export { HC_AUDIT, HC_LAUNCH_AUDIT } from "./guard-corpus-hc.js";
import { feedback } from "./feedback.js";
import { guard } from "./guard.js";
import { hookCommand } from "./io.js";
import { context, delta, record } from "./session-hooks.js";
import { retroScan } from "./retro-hook.js";
import { testHooks } from "./test-hooks.js";
import {
  kbCheckHook,
  skillLinks,
  workflowPermissions,
} from "./repository-checks.js";

const feedbackHelp: CommandHelp = {
  purpose:
    "Runs the checks behind a turn's feedback, one mode per host event. post-edit lints and format-checks the TypeScript file a Write or Edit changed; stop typechecks each project whose TypeScript changed this turn; tool-failure records the end of a failed tool. A failed check exits 2 with its report on stderr, which the host returns to the agent.",
  when: "The host runs post-edit on PostToolUse, tool-failure on PostToolUseFailure and stop on Stop, as .claude/settings.json wires them. Run one mode by hand only to see what the agent would be told.",
  whenNot:
    "To format or lint a file yourself, run mise run format on it, which writes the fix; this hook only checks and reports.",
  flags: {
    strict:
      "A fault exits 1 instead of failing open with 0. A failed check still exits 2.",
  },
  operand:
    "The mode: post-edit, stop or tool-failure. Any other value fails open with exit 0 and names the modes.",
  examples: [
    {
      command: "harness hook feedback post-edit",
      shows:
        "oxlint and prettier on an edited Write or Edit file; a finding exits 2 with the report on stderr",
    },
    {
      command: "harness hook feedback stop",
      shows:
        "the typecheck of each project whose TypeScript changed this turn, run before the turn ends; a failure exits 2",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "every check passed, or there was nothing to check; an unknown mode or a fault also exits 0, with the reason on stderr, because it fails open",
    },
    { code: 1, meaning: "a fault under --strict" },
    {
      code: 2,
      meaning:
        "a check failed: stderr holds the report and the command that fixes it, and the host returns it to the agent",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "appends ledger events: tool.end on post-edit and tool-failure, and on stop session.stop, with token.usage and token.split when the transcript has them. It sets a marker in the temporary directory when an edited TypeScript file is tracked, and clears it after a passing stop typecheck; the checks only read",
  },
  seeAlso: ["hook guard", "flow report"],
};

const feedbackHook = hookCommand(
  "feedback",
  "run the post-edit, stop or tool-failure feedback checks",
  ({ deps, payload, operand }) => feedback(operand, payload, deps),
  { operand: "mode", help: feedbackHelp },
);

const guardHelp: CommandHelp = {
  purpose:
    "Enforces the rules in AGENTS.md that can be checked mechanically, on every tool call the host is about to run: it blocks a call that breaks a rule set to enforce, and warns about a call that breaks a rule in audit mode. The host sends the call as PreToolUse JSON on stdin.",
  when: "The host runs it before every tool call, as .claude/settings.json wires it. A rule's mode is set in .claude/guardrails.yaml.",
  whenNot:
    "To check whether a rule change would block calls already made, run harness guardrail replay; to see each rule's mode, run harness guardrail status.",
  flags: {
    strict:
      "Accepted for uniformity: a fault already exits 1 here, so --strict changes nothing.",
  },
  examples: [
    {
      command: "harness hook guard",
      shows:
        "the call on stdin decides the output: a blocked call exits 2 with the rule's reason on stderr, and an allowed call exits 0 with nothing printed",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the call is allowed, or only warned about (the warning is printed as additionalContext on stdout); empty or malformed stdin is allowed too, so a broken payload never blocks",
    },
    {
      code: 1,
      meaning:
        "a fault the guard cannot read past; the host shows it, and the call is not blocked",
    },
    {
      code: 2,
      meaning: "the call is blocked; stderr names the rule and why",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "appends stage-ledger events: tool.start for each call; on a block, tool.end (failure) and guard.block, which names the rule but never the command; on a warning, guard.audit for each rule that fired. It reads .claude/guardrails.yaml and writes no file",
  },
  seeAlso: ["guardrail status", "guardrail replay", "hook feedback"],
};

const guardHook = hookCommand(
  "guard",
  "block or warn on tool calls that break a mechanical rule (PreToolUse)",
  ({ deps, payload }) => guard(payload, deps),
  { faultCode: 1, help: guardHelp },
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
  ...testHooks,
  "workflow-permissions": workflowPermissions,
};
// The session hint lines the context hook prints (#1803); the help check reads their help pointers.
export {
  MAIN_SESSION_WAIT_LINE,
  RESULT_SUMMARY_LINE,
  SIGNED_SEND_LINE,
} from "./context.js";
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
