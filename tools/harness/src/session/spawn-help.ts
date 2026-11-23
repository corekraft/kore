import type { CommandHelp } from "../runtime/index.js";

export const spawnHelp: CommandHelp = {
  purpose:
    "Starts one Claude session as one hc terminal under the caller's terminal, named, briefed and recorded: writes the session record in the main checkout before the terminal starts, starts the ledger watch, records the launch, and never waits. Collect the result with session wait. Usage errors are refused before any hc call. A writer is refused while the host lease is held or the 1-minute load average is above KORE_SPAWN_MAX_LOAD (unset by default, so no load check runs; a number such as 20 sets the limit). The output says the model the session launches at.",
  when: "When the main session hands a piece of work to a role, such as a reader or a writer, and the session must run as its own terminal with its own brief, then session wait collects its result.",
  whenNot:
    "When only the model and effort a role would launch at are needed: use session tier. When a session is already running and needs a message: use session send. session exec is the wrapper an hc terminal runs, not a session you start by hand.",
  flags: {
    role: "The role the session runs as: one with an agent definition in .claude/agents, such as writer or reader. Any other role is refused, and the defined roles are named.",
    model:
      "The claude model the session runs on, overriding the role's definition; omitted, the definition supplies it. While KORE_WRITER_EXPERIMENT_START holds a UTC date (unset by default, so no window), a writer that names no model is eligible: the window samples a share of them onto Sonnet, logged as an override with the reason experiment, and keeps the rest on the definition's model as the control, logged with the reason experiment-control. A writer that names a model is never sampled, so while the window is open the main session names no model for a writer. KORE_WRITER_EXPERIMENT_SHARE (above 0 and up to 1, default 0.1) and KORE_WRITER_EXPERIMENT_DAYS (whole days, default 14) set the share and the length; a misconfigured start, effort, share or length refuses a writer before any session starts.",
    effort:
      "The effort level the session runs at, overriding the role's definition; omitted, the definition supplies it. While the window is open, every eligible writer runs at the window effort whatever effort it names here: KORE_WRITER_EXPERIMENT_EFFORT, one of low, medium, high, xhigh or max, required while KORE_WRITER_EXPERIMENT_START is a UTC date and ignored while it is unset. The main session names no effort for a writer then.",
    name: "The session's name, in the words of its subject such as image-trust-reader: lowercase letters, digits, - and _, at most 32 characters. A name with a letter, ordinal or step number as a segment is refused.",
    brief:
      "The brief the session receives as its first prompt, passed as claude's own first-prompt argument, or to a file when it is longer than 128 KiB.",
    "no-wait":
      "Accepted for compatibility: a session on hc never waits, so this changes nothing. Collect the result with session wait.",
    worktree:
      "Runs the session in a git worktree under .claude/worktrees, on a new branch, after its dependencies are installed and the harness bundle is built there. A writer must have it. When that path already exists and the session's record says it was lost with its parent, on the same branch, that worktree is reused as it is; any other existing path is refused and left untouched.",
    branch:
      "The name of the new branch the worktree is created on; it defaults to the session's name. Valid only with --worktree.",
    idea: "The idea the session serves, as an issue number such as 338 or #338, recorded in the session record and the ledger. A writer's spawn with one also records each label of that issue as a session.labelled event; a failed lookup records none. Refused with --no-idea.",
    "no-idea":
      "Why the session serves no idea, as 1 to 100 characters with no control characters. Refused with --idea. A writer, judge or principles-review spawn with neither --idea nor --no-idea warns and still starts.",
    pr: "The pull request number the session works on, such as 612: a writer's relaunch, or a reader that verifies a PR. A --model that matches the escalation queue escalate recorded is logged as an escalation, not an override.",
    reason:
      "Why the tier was overridden, written into the launch event with an override: 1 to 100 characters with no control characters. Optional: a bare override is recorded and not refused.",
    group:
      "The group name a pair of sessions share, such as pair-a, in lowercase letters, digits, - and _, at most 32 characters. It labels the session group=<name>, so session send reaches its group's siblings.",
    timeout:
      "Accepted for compatibility and checked as a positive whole number of milliseconds; a session on hc is not waited on by spawn, so it sets no bound.",
  },
  examples: [
    {
      command:
        'harness session spawn --role reader --name image-trust-reader --brief "Check the image trust rules and report what they block"',
      shows:
        "a reader session starts as an hc terminal under the caller's; the command prints its name, terminal and model and exits 0 without waiting",
    },
    {
      command:
        'harness session spawn --role writer --name issue-1795-help --worktree --idea 1795 --brief "Work issue 1795"',
      shows:
        "a writer starts in its own worktree with its idea recorded; collect its result later with session wait issue-1795-help",
    },
    {
      command:
        'harness session spawn --role writer --name issue-1795-help --idea 1795 --brief "Work issue 1795"',
      shows:
        "the writer has no --worktree, so the command exits 2 before any terminal starts",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the session started and its record is settled with its terminal",
    },
    {
      code: 1,
      meaning:
        "failed after the checks: a writer held back by the host lease or the load, a name already in use, no terminal parent to run under, a role identity that could not be minted, or an hc call that failed",
    },
    {
      code: 2,
      meaning:
        "a usage error, refused before any terminal starts: a missing --role, --name or --brief, an invalid name, idea, reason, pr, group or timeout, a writer without --worktree, --branch without --worktree, --idea with --no-idea, a role with no agent definition, a model or effort the definition does not supply, or a misconfigured writer experiment window",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "writes the session record in the main checkout before the terminal starts, starts one hc terminal and the ledger watch, records the launch, and creates a worktree when asked. It appends ledger events: session.launch, a session.labelled per issue label for a writer with --idea, spawn.unstamped when a writer, judge or principles-review names no idea or any role gives --no-idea, and a host-sample. With --worktree it creates a git worktree and branch under .claude/worktrees. The role's token is made inside the terminal by session exec, from the identity store, never on argv or disk.",
  },
  seeAlso: ["session wait", "session tier", "session check", "session close"],
};
