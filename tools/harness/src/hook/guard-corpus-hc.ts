// The hc cases (plan 16, Step 4). The read-only roles and the judge may not drive a terminal: the allowlist
// refuses a raw hc send, label, run or exec and an HC_TERMINAL_ID prefix under role-read-only, and the
// read-only roles keep the hc reads. A bare hc launch of claude is refused under bare-agent-start. The
// writer's raw hc writes are not listed here: their refusal awaits the owner's approval of a new rule.
// guard-corpus.ts runs these through the hook.
import type { CorpusCase, OrdinaryCase } from "./guard-corpus.js";

const READ_ONLY = ["reader", "principles-review", "judgment"];
/** The roles that never run an hc command: the read-only roles and the judge. */
const NO_TERMINAL = [...READ_ONLY, "judge"];

const forRoles = (
  roles: readonly string[],
  rule: string,
  commands: readonly string[],
): CorpusCase[] =>
  roles.flatMap((role) =>
    commands.map((input): CorpusCase => ({ role, tool: "Bash", input, rule })),
  );

/** Raw hc writes, an HC_TERMINAL_ID prefix and a claude launch in hc's form, refused for the read-only roles and the judge. */
const DRIVING = forRoles(NO_TERMINAL, "role-read-only", [
  "hc send t1 hi",
  "hc send --json t1 hi",
  "hc label t1 kore-role=writer",
  "hc run --bg --cwd . -- ls",
  "hc run --bg -- claude --agent reader brief",
  "hc exec t1 -- ls",
  "HC_TERMINAL_ID=t1 hc get t1",
  "env HC_TERMINAL_ID=t1 hc ls",
  "HC_TERMINAL_ID=t1",
  "cat docs/index.md && hc send t1 hi",
  "echo $(hc send t1 hi)",
]);

/** The judge gets no hc read at all: the reads the read-only roles keep are refused for it. */
const JUDGE_READS = forRoles(["judge"], "role-read-only", [
  "hc get t1",
  "hc ls --json",
  "hc read t1",
  "hc wait t1",
  "hc --help",
]);

/** Hc verbs that are no read, refused for every role that never runs an hc command. */
const OTHER_VERBS = forRoles(NO_TERMINAL, "role-read-only", [
  "hc kill t1",
  "hc interrupt t1",
  "hc rm t1",
  "hc --version",
]);

/** A bare hc launch of claude starts a session outside harness session spawn, for the person's session and the writer. */
const LAUNCH: CorpusCase[] = [
  {
    tool: "Bash",
    input: "hc run --json --bg --cwd . -- claude --agent reader brief",
    rule: "bare-agent-start",
  },
  { tool: "Bash", input: "hc run --bg -- claude", rule: "bare-agent-start" },
  {
    tool: "Bash",
    input:
      "hc run --bg --name x -- harness session exec --role reader -- claude",
    rule: "bare-agent-start",
  },
  {
    role: "writer",
    tool: "Bash",
    input: "hc run --bg -- claude --agent writer brief",
    rule: "bare-agent-start",
  },
];

/** Every hc attempt the guard refuses. */
export const HC_REFUSED: readonly CorpusCase[] = [
  ...DRIVING,
  ...JUDGE_READS,
  ...OTHER_VERBS,
  ...LAUNCH,
];

/** The hc reads and the harness reports the three read-only roles keep (plan 16, Step 4). */
export const HC_ORDINARY: readonly OrdinaryCase[] = READ_ONLY.flatMap((role) =>
  [
    "hc get t1 --json",
    "hc ls --json",
    "hc read --json --lines 20 t1",
    "hc wait --json --timeout 5 t1",
    "hc --help",
    "hc get --help",
    "node skills/bin/harness.mjs session report",
    "node skills/bin/harness.mjs session send t3 --message hi",
  ].map((input): OrdinaryCase => ({ role, tool: "Bash", input })),
);
