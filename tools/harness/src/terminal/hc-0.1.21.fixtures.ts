// hc 0.1.21's `--json` output for each Terminals method, and the structured
// errors it writes to stderr. Shaped from hc 0.1.21's schema (`hc schema`) and
// its `hc <command> --help`, not yet recorded from a live core: the recorded
// replacement comes from the integration test (plan 16, Step 2). The names
// carry the version, so a new hc means a new set.

const writer = {
  address: "t7",
  name: "s1",
  parent: "t3",
  argv: ["claude", "--agent", "writer", "--model", "sonnet", "brief text"],
  cwd: "/work/kore",
  labels: { "kore-session": "s1", role: "writer" },
  state: "live",
  status: "working",
  reported: true,
  notify: true,
  created_ms: 1763800000000,
  screen: "exact",
  cols: 120,
  rows: 40,
  exit_code: null,
  finished_ms: null,
};

const writerFinished = {
  ...writer,
  state: "finished",
  status: null,
  exit_code: 0,
  finished_ms: 1763800600000,
  reason: "exited",
};

const sibling = {
  ...writerFinished,
  address: "t8",
  name: "s2",
  exit_code: 0,
};

const otherParent = { ...writer, address: "t9", name: "s3", parent: "t4" };

export const HC_0_1_21 = {
  version: "hc 0.1.21\n",
  run: JSON.stringify(writer),
  get: JSON.stringify(writerFinished),
  list: JSON.stringify({
    terminals: [writer, sibling, otherParent],
    hidden_finished: 0,
    machines: [],
  }),
  read: JSON.stringify({
    text: "ready\n> ",
    complete: true,
    how: "screen",
    why: null,
  }),
  send: JSON.stringify({ turn: 4, started: true, status: "working" }),
  waitTerminal: JSON.stringify({
    terminal: "t7",
    ended: true,
    reason: "exit",
    turn: 4,
    children: [],
    exit_code: 0,
    status: null,
    signal: null,
  }),
  waitChildren: JSON.stringify({
    terminal: "t3",
    ended: true,
    reason: "children",
    turn: 0,
    children: [
      {
        terminal: "t7",
        ended: true,
        reason: "exit",
        turn: 4,
        children: [],
        exit_code: 0,
      },
      {
        terminal: "t8",
        ended: false,
        reason: "running",
        turn: 1,
        children: [],
      },
    ],
  }),
  waitTimeout: JSON.stringify({
    terminal: "t7",
    ended: false,
    reason: "timeout",
    turn: 4,
    children: [],
  }),
  waitMessage: JSON.stringify({
    terminal: "t3",
    ended: false,
    reason: "message",
    turn: 0,
    children: [],
  }),
  interrupt: JSON.stringify({ key: "esc", outcome: "stopped" }),
  kill: JSON.stringify({
    ...writerFinished,
    exit_code: null,
    reason: "killed",
  }),
  remove: JSON.stringify({ removed: "t7" }),
  label: JSON.stringify({
    ...writer,
    labels: { ...writer.labels, model: "sonnet" },
  }),
  errors: {
    notFound: JSON.stringify({
      error: {
        kind: "not_found",
        message: "no terminal t9",
        hint: "list the terminals with hc ls --all",
      },
    }),
    finished: JSON.stringify({
      error: {
        kind: "finished",
        message: "t7 has finished",
        hint: "start a new terminal instead",
      },
    }),
    live: JSON.stringify({
      error: {
        kind: "live",
        message: "t7 is still live",
        hint: "end it first with hc kill t7",
      },
    }),
    nameTaken: JSON.stringify({
      error: {
        kind: "name_taken",
        message: "a live terminal is already named s1",
        hint: "pick another name",
      },
    }),
    statusMismatch: JSON.stringify({
      error: {
        kind: "status_mismatch",
        message: "t7 is working, not idle",
        hint: "wait until it is idle, then send",
      },
    }),
    blocked: JSON.stringify({
      error: {
        kind: "blocked",
        message: "t7 is blocked on a permission",
        hint: "read it with hc read t7",
      },
    }),
  },
};
