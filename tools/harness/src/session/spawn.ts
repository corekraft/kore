import type { CommandContext, CommandHelp } from "../runtime/index.js";
import { launch } from "./launch.js";
import { FAILED, fail } from "./output.js";
import { check } from "./spawn-check.js";
import { SessionRegistry } from "./registry.js";
import { finish } from "./spawn-finish.js";
import { openPane } from "./spawn-pane.js";
import { roleToken } from "./role-token.js";

/** `session spawn`: place, name and brief a Claude session in a new Herdr pane, then wait for its result unless --no-wait. */
export async function spawn(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  const checked = await check(context);
  if ("error" in checked) {
    return fail(deps, json, checked.code, checked.error);
  }
  const { name, model, role, effort } = checked.values;
  const { callerPane } = checked;
  // Before any herdr or git call, so a missing identity leaves nothing to clean up.
  const identity = await roleToken(deps, role);
  if (identity !== undefined && "error" in identity) {
    return fail(deps, json, FAILED, identity.error);
  }
  const registry = await SessionRegistry.open(deps);
  const opened = await openPane(context, checked, registry, identity?.token);
  if ("error" in opened) {
    return fail(deps, json, FAILED, opened.error);
  }
  const { paneId, leftOpen, placed } = opened;
  const modelCheck = await launch(deps, {
    ...checked.values,
    paneId,
    callerPane,
    leftOpen,
  });
  if ("error" in modelCheck) {
    return fail(deps, json, FAILED, opened.explain(modelCheck.error));
  }
  return await finish(context, {
    registry,
    modelCheck,
    record: {
      name,
      paneId,
      callerPane,
      model,
      role,
      effort,
      ...(placed.worktree === undefined ? {} : { worktree: placed.worktree }),
      createdAt: deps.clock.now().toISOString(),
    },
    timeoutMs: checked.timeoutMs,
    tier: checked.tier,
    ...(checked.stage === undefined ? {} : { stage: checked.stage }),
    ...(checked.unstamped === undefined
      ? {}
      : { unstamped: checked.unstamped }),
    ...(checked.idea === undefined ? {} : { idea: checked.idea }),
  });
}

export const spawnHelp: CommandHelp = {
  purpose:
    "Starts one Claude session in a new Herdr pane beside the caller's, named, briefed and recorded, then waits for its RESULT line unless --no-wait is given. Every refusal it can make is checked before any Herdr call, and its output says whether the model was verified.",
  when: "When the main session hands a piece of work to a role, such as a reader or a writer, and the session must run in its own pane with its own brief.",
  whenNot:
    "When only the model and effort a role would launch at are needed: use session tier. When a session is already running and needs a message: use session send. After a --no-wait start, collect the result with session wait; session exec is the wrapper an hc terminal runs, not a pane.",
  flags: {
    role: "The role the session runs as: one with an agent definition in .claude/agents, such as writer or reader. Any other role is refused, and the defined roles are named.",
    model:
      "The claude model the session runs on, overriding the role's definition; omitted, the definition supplies it. While the writer experiment window is open, a writer that names no model may be sampled onto Sonnet; a writer that names a model is never sampled.",
    effort:
      "The effort level the session runs at, overriding the role's definition; omitted, the definition supplies it. While the writer experiment window is open, a writer that names no model runs at the window's effort whatever effort it names here.",
    name: "The session's name, in the words of its subject such as image-trust-reader: lowercase letters, digits, - and _, at most 32 characters, with no letter, ordinal or step number as a segment.",
    brief:
      "The brief the session receives as its first prompt. A brief with a line that is only a RESULT marker is refused, since that line would end the wait early.",
    "no-wait":
      "Returns once the session is started and recorded, without waiting for its RESULT line; collect the result later with session wait.",
    worktree:
      "Runs the session in a new git worktree under .claude/worktrees, on a new branch, after its dependencies are installed and the harness bundle is built there. A writer must have it.",
    branch:
      "The name of the new branch the worktree is created on; it defaults to the session's name. Valid only with --worktree.",
    idea: "The idea the session serves, as an issue number such as 338 or #338. It is stamped into the pane for the ledger, and a writer's launch also records the issue's labels. Refused with --no-idea.",
    "no-idea":
      "Why the session serves no idea, as 1 to 100 characters with no control characters. Refused with --idea.",
    pr: "The pull request number the session works on, such as 612: a writer's relaunch, or a reader that verifies a PR. A --model that matches the escalation queue escalate recorded is logged as an escalation, not an override.",
    reason:
      "Why the tier was overridden, logged with the launch when a --model or --effort is an override: 1 to 100 characters with no control characters. Optional.",
    timeout:
      "The wait's bound in milliseconds, a positive whole number; the default is one hour. When it passes with no RESULT line, the command exits 1 and the session keeps running.",
  },
  examples: [
    {
      command:
        'harness session spawn --role reader --name image-trust-reader --brief "Check the image trust rules and report what they block" --no-wait',
      shows:
        "a reader session starts in a new pane; the command prints its name, pane and model verdict and exits 0 without waiting",
    },
    {
      command:
        'harness session spawn --role writer --name issue-1795-help --worktree --idea 1795 --brief "Work issue 1795" --timeout 1800000',
      shows:
        "a writer starts in its own worktree with its idea stamped, then waits up to 30 minutes and prints its RESULT outcome",
    },
    {
      command:
        'harness session spawn --role writer --name issue-1795-help --idea 1795 --brief "Work issue 1795"',
      shows:
        "the writer has no --worktree, so the command exits 2 before any pane is split",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the session started: with --no-wait the command returns at once; otherwise its RESULT line arrived and its outcome is printed. A blocked outcome also exits 0, so read the outcome",
    },
    {
      code: 1,
      meaning:
        "failed after the checks: not inside Herdr, a writer held back by the host lease or the load, a role token that could not be minted, a name already in use, a Herdr call that failed, the pane's launch that failed, or no RESULT line within --timeout; stderr names any pane left open",
    },
    {
      code: 2,
      meaning:
        "a usage error, refused before any pane is split: a missing --role, --name or --brief, an invalid name, idea, reason, pr or timeout, a brief with a RESULT line, a writer without --worktree, --branch without --worktree, --idea with --no-idea, a role with no agent definition, a model or effort the definition does not supply, or a misconfigured writer experiment window",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "splits a Herdr pane beside the caller's column and equalizes that column; records the session's registry entry; appends ledger events: session.launch, a session.labelled per issue label for a writer with --idea, spawn.unstamped when a writer, judge or principles-review names no idea or any role gives --no-idea, and a host-sample. With --worktree it creates a git worktree and branch under .claude/worktrees. With the role-tokens flag on, a role with a GitHub identity gets its token through a FIFO, never on the command line",
  },
  seeAlso: ["session wait", "session tier", "session check", "session close"],
};
