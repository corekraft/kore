// oxlint-disable import/max-dependencies -- the session domain is one command per module, so its barrel imports each of them
import type { Command } from "../runtime/index.js";
export { handOff } from "./handoff.js";
export { FOLLOW_UP_PREFIX } from "./follow-up-prefix.js";
export { findResult, parseTimeout } from "./wait.js";
export {
  openSessionTarget,
  settleSessionTarget,
  type OpenedTarget,
  type SessionWaitTarget,
} from "./wait-target.js";
export { hostLeaseRefusal } from "./host-lease.js";
export { deliver } from "./notify.js";
export { signedMainSendsOn } from "./signed-sends.js";
export { sessionNameError } from "./names.js";
export { spawnLoadRefusal } from "./spawn-load.js";
export { PASSED_FLAGS, namesFlag } from "./exec.js";
import { check } from "./check.js";
import { close } from "./close.js";
import { execCommand } from "./exec.js";
import { equalize } from "./equalize.js";
import { notify } from "./notify.js";
import { report } from "./report.js";
import { send } from "./send.js";
import { spawn } from "./spawn.js";
import { tier } from "./tier.js";
import { wait } from "./wait.js";

const spawnCommand: Command = {
  summary:
    "start a Claude session in a Herdr pane (--role is a role with an agent definition in .claude/agents, and any other is refused with the defined roles named, so brief a verifier or fixer as a reader or a writer; --name is named after its subject in the domain's own words, such as image-trust-reader, and a name with a letter, ordinal or step number is refused; --brief [--model --effort, default from .claude/agents/<role>.md] --pr N names the PR when relaunching its writer, so a model flag matching the escalation `queue escalate` recorded is logged as an escalation; any other --model or --effort is logged as an override, and --reason <why> (1 to 100 characters) is written into the launch event with it, a bare override is recorded and not refused; --idea N|#N stamps the idea into the pane's environment for the ledger, and a writer's spawn with one also records each label of that issue as a session.labelled event (a failed lookup records none);--no-idea <reason> (1 to 100 characters) says why a session serves no idea, and is refused with --idea; a writer, judge or principles-review spawn with neither warns and still starts; --timeout ms; --worktree [--branch b] runs it in a new git worktree under .claude/worktrees); with the role-tokens flag on in the local environment overlay (off by default, and spawn is unchanged while it is), a writer pane gets a minted kore-writer installation token, a principles-review (Reviewer) pane a minted kore-reviewer token, an advisor or orchestrator pane a minted kore-orchestrator token, and a judge pane the judge PAT, as GH_TOKEN through a FIFO, never argv or disk (a missing identity fails with a hint naming tools/harness/wizards/identities.sh; on a Linux host the identities are read from the sops-encrypted ~/.config/kore/identities.sops.json instead of the keychain, filled from the Mac by `identities.sh --transfer <user@host>`; a role with no identity of its own gets none); with the owner-writer flag also on (off by default), a writer pane gets the owner's own gh login token, read with gh auth token at spawn (a failure refuses and says to run gh auth login), and a judge pane a minted kore-judge installation token instead of the judge PAT; a writer is refused while the host lease is held or while the 1-minute load average is above KORE_SPAWN_MAX_LOAD (unset by default, so no load check; set it to a number such as 20, and retry or raise it to override); while KORE_WRITER_EXPERIMENT_START is a UTC date (unset by default, so no window) a writer that names no --model is eligible: the window samples a share of them onto Sonnet, recorded as an override with the reason experiment, and keeps the rest on their definition's model as the control, recorded with the reason experiment-control; every eligible writer runs at the window effort whatever --effort it names; a writer that names a --model is never sampled; KORE_WRITER_EXPERIMENT_EFFORT sets the window effort, one of low, medium, high, xhigh or max, required while KORE_WRITER_EXPERIMENT_START is a UTC date and ignored while it is unset; while KORE_WRITER_EXPERIMENT_START is a UTC date, the main session names no --model for a writer, because an explicit --model overrides the sampling, and names no --effort or the window effort; KORE_WRITER_EXPERIMENT_SHARE sets the share (a number above 0 and up to 1, default 0.1, so 10 percent) and KORE_WRITER_EXPERIMENT_DAYS the length in whole days (default 14); a misconfigured start, effort, share or length refuses a writer before any session starts; it waits for the result unless --no-wait, the normal pattern: spawn with --no-wait, then run `session wait <name>` in the background",
  options: {
    role: "string",
    model: "string",
    effort: "string",
    name: "string",
    brief: "string",
    "no-wait": "boolean",
    worktree: "boolean",
    branch: "string",
    idea: "string",
    "no-idea": "string",
    pr: "string",
    reason: "string",
    timeout: "string",
  },
  run: spawn,
};

const waitCommand: Command = {
  summary:
    "wait for a spawned session's RESULT line and print its outcome; --json adds result.summary, the text the pane printed before that line (<name> --timeout ms)",
  operand: "name",
  options: { timeout: "string" },
  run: wait,
};

const notifyCommand: Command = {
  summary:
    "tell the caller pane this session finished: sends `sender: <role> <name> (session notify): finished: RESULT <outcome>; summary in pane <this pane>` to <pane> and submits it, then confirms it shows there (<pane> --outcome done|blocked; a spawned session runs it as its last action, from the brief)",
  operand: "pane",
  options: { outcome: "string" },
  run: notify,
};

const reportCommand: Command = {
  summary:
    "record this hc session's outcome: writes .kore/report/<session>.json with the next seq, then sends the parent one notice line (--outcome done|blocked, and exactly one of --summary <text> or --file <path>, a file under .kore/report; --plan <file> stores its text with the report); the last action of a session that session spawn started on hc",
  options: {
    outcome: "string",
    summary: "string",
    file: "string",
    plan: "string",
  },
  help: {
    purpose:
      "Records how a spawned hc session finished as a numbered report file, which the waiting parent reads, then tells the parent in one fixed line that the report is there.",
    when: "As the last action of a session that session spawn started on hc, once its work is finished or it is blocked.",
    whenNot:
      "Outside a session's own terminal, which it refuses, and for a herdr pane, which reports through its RESULT line. After a rework, report again: each report takes the next seq, and the parent reads the new one.",
    flags: {
      outcome:
        "done when the work is finished, blocked when it cannot go on without a person.",
      summary:
        "The summary text. It is kept in the report file and is never sent to the parent.",
      file: "A file that holds the summary, under .kore/report in the session's checkout. Use it for a long answer.",
      plan: "A file whose text is stored with the report as its plan, such as a judgment's plan JSON.",
    },
    examples: [
      {
        command:
          'harness session report --outcome done --summary "Opened PR #1775."',
        shows:
          "the report file is written with seq 1, and the parent gets one line naming it",
      },
      {
        command:
          "harness session report --outcome blocked --file .kore/report/why.md",
        shows:
          "a blocked report whose summary is read from a file under .kore/report",
      },
    ],
    exits: [
      {
        code: 0,
        meaning:
          "the report is written; the parent got its notice, or is not an agent terminal",
      },
      {
        code: 1,
        meaning:
          "refused or failed: no open hc session for this terminal, a --file outside .kore/report, or hc or the notice failed; a report already written is kept",
      },
      {
        code: 2,
        meaning:
          "a usage error: --outcome, or exactly one of --summary and --file, is missing or wrong",
      },
    ],
    effects: {
      kind: "mutates",
      detail:
        "Writes .kore/report/<session>.json in the session's checkout, then sends one notice line to the parent when it is an agent terminal.",
    },
    seeAlso: ["session wait", "session close"],
  },
  run: report,
};

const sendCommand: Command = {
  summary:
    "send a follow-up to a spawned session's pane: writes the sender line first, from this session's spawn environment (`sender: <role> <name> (session send): <message>`, or `the main session` with no role), so the retro scan never counts it as an owner correction; submits it, confirms it shows in the pane, and records a session.send event naming the sender (<name> --message <one line of text>)",
  operand: "name",
  options: { message: "string" },
  run: send,
};

const checkCommand: Command = {
  summary:
    "with the role-tokens flag on, report each writer or judge pane that session spawn did not start, because it runs without its token and sandbox; start it with session spawn instead (read-only, exits 1 when it finds one)",
  run: check,
};

const closeCommand: Command = {
  summary:
    "close a spawned pane once its result is recorded (<name>; only the pane that spawned it); --remove-worktree also removes its worktree and deletes its branch, only when a merged PR has that branch as its head and the worktree is clean, otherwise it keeps both and exits 1",
  operand: "name",
  options: { "remove-worktree": "boolean" },
  run: close,
};

const tierCommand: Command = {
  summary:
    "print the model and effort a role launches at, from .claude/agents/<role>.md (<role>; read-only)",
  operand: "role",
  run: tier,
};

const equalizeCommand: Command = {
  summary: "equalize the heights of the spawned panes (run after closing one)",
  async run({ json, deps }) {
    const callerPane = deps.env.HERDR_PANE_ID;
    if (deps.env.HERDR_ENV !== "1" || !callerPane) {
      deps.stderr(
        "Not inside Herdr (HERDR_ENV is not 1 or HERDR_PANE_ID is unset). Run this from a Herdr pane.\n",
      );
      return 1;
    }
    const result = await equalize(deps.runner, callerPane);
    if (result.status === "failed") {
      deps.stderr(`${result.reason}\n`);
      return 1;
    }
    const text =
      result.status === "skipped" ? `Skipped: ${result.reason}.` : "Equalized.";
    deps.stdout(json ? `${JSON.stringify(result)}\n` : `${text}\n`);
    return 0;
  },
};

/** The `session` domain: commands that run other Claude sessions in Herdr panes. */
export const session: Record<string, Command> = {
  spawn: spawnCommand,
  wait: waitCommand,
  notify: notifyCommand,
  report: reportCommand,
  send: sendCommand,
  check: checkCommand,
  close: closeCommand,
  tier: tierCommand,
  equalize: equalizeCommand,
  exec: execCommand,
};
export { resolveTier } from "./agent-definition.js";
