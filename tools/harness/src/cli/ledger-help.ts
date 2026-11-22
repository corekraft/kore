// The help records of the ledger commands (plan 17). They sit beside ledger-commands.ts, which
// attaches each to its command, so the command file stays within its size budget.
import type { CommandHelp } from "../runtime/index.js";

export const recordHelp: CommandHelp = {
  purpose:
    "Appends one validated event to the stage ledger, the shared record of what happened, from flags or from one JSON event on stdin. Each field is checked against the event's kind, and an event the ledger cannot hold is refused; the ledger sets the event's schema and recordedAt, and its id when no --id is given.",
  when: "When something happened that no other command records, such as a session starting by hand, and flow, status or the outcome reports need it in the ledger.",
  whenNot:
    "When a command already records the event: decision make, decision route, decision ask and decision digest record their decisions, and ledger poll-herdr and ledger poll-github record the panes and GitHub's records. GitHub's own records are refused here: a source of github, and the kinds only the poller writes, such as pr.merged.",
  flags: {
    id: "The event's id, a name of letters, digits and . _ : / # @ - up to 128 characters. Without it the ledger assigns one.",
    source:
      "Where the event came from: claude, herdr or github. Required; github is refused, as only ledger poll-github writes GitHub's records.",
    kind: "The event's kind, one of the ledger's kinds, such as session.start or tool.end. Required; a kind only the poller writes is refused.",
    "occurred-at":
      "When the event happened, as an ISO 8601 UTC time such as 2026-01-02T03:04:05.000Z. Required; the ledger does not stamp it.",
    session:
      "The session the event belongs to, as a name of letters, digits and . _ : / # @ - up to 128 characters.",
    pane: "The herdr pane the event belongs to, as a name of the same form.",
    agent:
      "The agent the event belongs to, as a name of the same form; required on pr.linked, which names the writer's agent.",
    idea: "The idea the event concerns, as a name of the same form.",
    stage:
      "A name for the stage the event belongs to, of the same form. The ledger stores it as given and does not check it against a list of stages.",
    tool: "The tool name, of letters, digits and . _ : - up to 100 characters; allowed only on tool.start and tool.end.",
    outcome:
      "success or failure; allowed only on tool.end, ci.main and ci.nightly.",
    label:
      "A label of 1 to 100 characters with no control characters; required on the kinds that carry one, such as decision.made, where it is the decision's category.",
    number:
      "A positive whole number, the issue or pull request the event is about; required on the kinds that carry one, such as pr.merged, and optional on decision.made and decision.routed.",
    tokens:
      "A positive whole number of the session's cumulative tokens; required on token.usage and allowed only there.",
    role: "The role a session was launched as, as a name of the same form; required on session.launch and spawn.unstamped.",
    tier: "The model tier a session launched on, as a name of the same form; required on session.launch and allowed only there.",
    ledger:
      "The ledger file to append to, resolved from the working directory. Default: the shared ledger under the main checkout root (.kore/state/ledger.jsonl), where KORE_ROOT overrides the root.",
  },
  examples: [
    {
      command:
        "harness ledger record --source claude --kind session.start --occurred-at 2026-01-02T03:00:00Z --session s1",
      shows: "one event appended, printed as recorded <id> session.start",
    },
    {
      command: "harness ledger record < event.json",
      shows:
        "one JSON event read from event.json, appended and printed the same way",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the event is appended; its id and kind are printed, or the event itself under --json",
    },
    {
      code: 1,
      meaning:
        "the event is refused and nothing is appended: a field fails its rule, the source is github or the kind is poller-only, stdin is not valid JSON, or no shared ledger root can be found",
    },
    {
      code: 2,
      meaning: "no event is given: no event flag, and an empty stdin",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "appends one line to the ledger file. The ledger is append-only and is written only through this command, never by hand; nothing else changes.",
  },
  seeAlso: ["ledger list", "ledger poll-herdr", "ledger poll-github"],
};

export const listHelp: CommandHelp = {
  purpose:
    "Reads the stage ledger and prints the events that match every filter given: by session, pane, idea, source, kind and time. A line of the ledger that is not a valid event is counted and skipped, not printed.",
  when: "When you need the events of one session, idea or kind, or of one time window, such as the events behind a stalled pane or a merged change.",
  whenNot:
    "When you need the state of the work rather than its events: use status. To add an event, use ledger record. This command writes nothing.",
  flags: {
    session: "Only the events of this session.",
    pane: "Only the events of this herdr pane.",
    idea: "Only the events about this idea.",
    source:
      "Only the events from this source: claude, herdr or github. Any other value is refused with exit 2.",
    kind: "Only the events of this kind. A kind the ledger does not know is refused with exit 2.",
    since:
      "The earliest occurredAt to keep, inclusive, as an ISO 8601 UTC time such as 2026-01-02T03:04:05Z. A malformed time is refused with exit 2.",
    until:
      "The end of the window on occurredAt, exclusive, in the same form as --since.",
    ledger:
      "The ledger file to read, resolved from the working directory. Default: the shared ledger under the main checkout root (.kore/state/ledger.jsonl), where KORE_ROOT overrides the root.",
  },
  examples: [
    {
      command: "harness ledger list --session s1 --since 2026-01-02T00:00:00Z",
      shows:
        "the events of session s1 from that time on, one line each: the time, source, kind, and the session, pane and idea each event names",
    },
    {
      command: "harness ledger list --kind pr.merged --json",
      shows:
        "the merged-pull-request events as one object, with the count of malformed lines skipped",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the matching events are printed, then a line counting any malformed lines skipped; no match prints nothing and still exits 0",
    },
    {
      code: 1,
      meaning: "no shared ledger root can be found and no --ledger is given",
    },
    {
      code: 2,
      meaning:
        "a filter is invalid: an unknown --source or --kind, or a --since or --until that is not an ISO 8601 UTC time",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the ledger file and prints; a missing ledger reads as empty. It writes nothing.",
  },
  seeAlso: ["ledger record", "status", "flow report"],
};

export const pollHerdrHelp: CommandHelp = {
  purpose:
    "Reads herdr's agent panes once and appends to the ledger only what changed since the last poll: pane.spawned, pane.busy, pane.waiting and pane.closed, and pane.stalled for a spawned pane that is idle or gone past 300 seconds with no result. pane.closed means the pane no longer hosts an agent.",
  when: "When the panes' state should be in the ledger now, before status or a flow report, or from a wait loop. A session start already runs it in the background.",
  whenNot:
    "When you want to act on a pane: this command only reads herdr, and never closes, restarts or messages a pane. To read one session's result, use session wait.",
  flags: {
    ledger:
      "The ledger file to append to, resolved from the working directory. Default: the shared ledger under the main checkout root (.kore/state/ledger.jsonl), where KORE_ROOT overrides the root.",
  },
  examples: [
    {
      command: "harness ledger poll-herdr",
      shows:
        "the number of herdr events recorded by this poll, 0 when no pane changed",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the poll ran; the number of herdr events recorded is printed, possibly 0",
    },
    {
      code: 1,
      meaning:
        "herdr agent list failed or printed output the poll cannot read, another poll holds the lock beside the ledger, or no shared ledger root can be found",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "reads herdr's agent list, then appends the changed pane events to the ledger, which is append-only and written only here. It holds a lock file beside the ledger while it runs, so one poll runs at a time. It never closes, restarts or messages a pane.",
  },
  seeAlso: ["ledger list", "ledger poll-github", "harness wait"],
};

export const pollGithubHelp: CommandHelp = {
  purpose:
    "Reads GitHub through gh and appends what it finds: issue.opened, issue.labelled, pr.opened and pr.merged from the issues and pull requests; then the outcome signals agents cannot write: ci.main and ci.nightly from workflow runs, main.revert from commits on main, and advisor.overturned, owner.action and owner.replied from the owner login's comments, events and reviews. It records numbers, labels, conclusions and GitHub times only, never titles, bodies, messages or logins.",
  when: "When the ledger needs GitHub's records, such as a merged pull request for evaluate or an owner's reply to a reserved question. A session start already runs it in the background.",
  whenNot:
    "When you need one pull request's checks: use pr checks. This command only reads GitHub: it never comments, labels or merges.",
  flags: {
    since:
      "The earliest time gh is asked for, as an ISO 8601 UTC time. It bounds only what gh is asked for, since recorded ids decide what is new. Default: the latest recorded GitHub event, and for the outcome signals a day before the latest recorded signal. A listing that reaches the limit fails the poll; pass a later --since.",
    repo: "The repository to poll, as owner/name. Default: corekraft/kore. A value that is not owner/name is refused with exit 2.",
    ledger:
      "The ledger file to append to, resolved from the working directory. Default: the shared ledger under the main checkout root (.kore/state/ledger.jsonl), where KORE_ROOT overrides the root.",
  },
  examples: [
    {
      command: "harness ledger poll-github --since 2026-01-01T00:00:00Z",
      shows:
        "the number of GitHub events recorded from that time on; polling the same window again records 0",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the poll ran; the number of GitHub events recorded is printed, possibly 0",
    },
    {
      code: 1,
      meaning:
        "gh failed, with a rate limit named with its retry time where GitHub gives one; a listing reached the limit, so some events may be missing; another poll holds the lock; the harness config names no readable owner login; or no shared ledger root can be found",
    },
    {
      code: 2,
      meaning:
        "--since is not an ISO 8601 UTC time, or --repo is not owner/name",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "reads issues, pull requests, workflow runs, commits and the owner's events through gh, and appends the new events to the ledger, which is append-only and written only here. It holds a lock file beside the ledger while it runs. It writes nothing on GitHub.",
  },
  seeAlso: ["ledger list", "ledger poll-herdr", "harness wait"],
};
