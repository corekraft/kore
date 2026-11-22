// Test helpers and expected values for the hc adapter's spec. Not a unit, so no
// spec of its own (ADR 0098). The expected Terminal values are what the adapter
// maps hc 0.1.21's recorded replies to (hc-0.1.21.fixtures.ts).
import { vi, type Mock } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import { HC_0_1_21, RECORDED_CWD } from "./hc-0.1.21.fixtures.js";
import {
  isHcList,
  isHcRead,
  isHcRemoved,
  isHcTerminal,
  isHcWait,
  isJsonObject,
} from "./hc-shapes.js";
import type { Terminal, Terminals } from "./port.js";

export const PIN_INSTALL =
  'install the pinned hc 0.1.21 with "hc update --version 0.1.21" (or "hc update --from <file>" for the exact binary), then confirm with "hc --version"';

export const PIN_DOC_HINT =
  'install the pinned hc 0.1.21 as docs/operations/hc-pin.md describes, then confirm with "hc --version"';

export const VERSION_OK: RunResult = {
  stdout: HC_0_1_21.version,
  stderr: "",
  code: 0,
};

export function ok(stdout: string): RunResult {
  return { stdout, stderr: "", code: 0 };
}

export function failed(code: number, stderr: string): RunResult {
  return { stdout: "", stderr, code };
}

/** A Runner whose calls return these results in order. */
export function scripted(...results: RunResult[]): {
  run: Mock<Runner["run"]>;
} {
  const run = vi.fn<Runner["run"]>();
  for (const result of results) {
    run.mockResolvedValueOnce(result);
  }
  return { run };
}

/** The recorded reply's text, for the read row. */
const READ_TEXT = (JSON.parse(HC_0_1_21.read) as { text: string }).text;

/** s1 while it is live, as the recorded get reports it. */
export const WRITER_LIVE: Terminal = {
  id: "t2",
  name: "s1",
  parent: "t1",
  state: "live",
  labels: { "kore-session": "s1", role: "writer" },
  cwd: RECORDED_CWD,
};

/** s1 after it exited with 0, labelled model=sonnet, as the recorded get reports it. */
export const WRITER_FINISHED: Terminal = {
  id: "t2",
  name: "s1",
  parent: "t1",
  state: "finished",
  labels: { "kore-session": "s1", role: "writer", model: "sonnet" },
  cwd: RECORDED_CWD,
  exitCode: 0,
};

/** s2 after it exited with 2. */
export const SIBLING_FINISHED: Terminal = {
  id: "t3",
  name: "s2",
  parent: "t1",
  state: "finished",
  labels: { "kore-session": "s2", role: "writer" },
  cwd: RECORDED_CWD,
  exitCode: 2,
};

/** s3, killed with no exit code and no labels. */
export const KILLED_SIBLING: Terminal = {
  id: "t4",
  name: "s3",
  parent: "t1",
  state: "finished",
  labels: {},
  cwd: RECORDED_CWD,
};

/** s4, the child that hc killed when its parent was killed. */
export const KILLED_CHILD: Terminal = {
  id: "t5",
  name: "s4",
  parent: "t1",
  state: "finished",
  labels: {},
  cwd: RECORDED_CWD,
};

export type Row = [
  name: string,
  call: (terminals: Terminals) => Promise<unknown>,
  argv: string[],
  stdout: string,
  expected: unknown,
];

export const rows: Row[] = [
  [
    "get",
    (t) => t.get("t2"),
    ["get", "--json", "t2"],
    HC_0_1_21.get,
    WRITER_LIVE,
  ],
  [
    "run",
    (t) => t.run({ argv: ["sh"], cwd: RECORDED_CWD, env: {} }),
    ["run", "--json", "--bg", "--cwd", RECORDED_CWD, "--", "sh"],
    HC_0_1_21.run,
    { id: "t1" },
  ],
  [
    "read",
    (t) => t.read("t2", 2),
    ["read", "--json", "--lines", "2", "t2"],
    HC_0_1_21.read,
    { text: READ_TEXT },
  ],
  [
    "send",
    (t) => t.send("t2", "exit 0"),
    ["send", "--json", "--", "t2", "exit 0"],
    HC_0_1_21.send,
    { id: "t2" },
  ],
  [
    "interrupt",
    (t) => t.interrupt("t4"),
    ["interrupt", "--json", "t4"],
    HC_0_1_21.interrupt,
    { id: "t4" },
  ],
  [
    "kill",
    (t) => t.kill("t4"),
    ["kill", "--json", "t4"],
    HC_0_1_21.kill,
    { id: "t4" },
  ],
  [
    "remove",
    (t) => t.remove("t4"),
    ["rm", "--json", "t4"],
    HC_0_1_21.remove,
    { id: "t4" },
  ],
  [
    "label",
    (t) => t.label("t2", { model: "sonnet" }),
    ["label", "--json", "t2", "model=sonnet"],
    HC_0_1_21.label,
    { id: "t2" },
  ],
];

/** The argv the adapter gives hc run for a labelled child with a parent, and the program's argv after --. */
export const RUN_CLAUDE = [
  "claude",
  "--agent",
  "writer",
  "--model",
  "sonnet",
  "brief text",
];
export const RUN_ARGV = [
  "run",
  "--json",
  "--bg",
  "--name",
  "s1",
  "--cwd",
  RECORDED_CWD,
  "--label",
  "role=writer",
  "--label",
  "kore-session=s1",
  "--parent",
  "t1",
  "--outlive-parent",
  "--",
  ...RUN_CLAUDE,
];

/** The reply hc gives a wait that a message ended. hc documents the reason; the recording did not hit it. */
export const MESSAGE_WAIT = JSON.stringify({
  terminal: "t1",
  ended: false,
  reason: "message",
  children: [],
});

/** Each method that reads a reply, the shape check that guards it, and the call that reads it. */
export const SHAPE_CHECKS: [
  verb: string,
  call: (t: Terminals) => Promise<unknown>,
  predicate: unknown,
][] = [
  ["run", (t) => t.run({ argv: ["bash"], cwd: "/w" }), isHcTerminal],
  ["get", (t) => t.get("t2"), isHcTerminal],
  ["ls", (t) => t.list(), isHcList],
  ["read", (t) => t.read("t2", 1), isHcRead],
  ["wait", (t) => t.wait({ terminal: "t2" }, 1000), isHcWait],
  ["rm", (t) => t.remove("t2"), isHcRemoved],
  ["kill", (t) => t.kill("t2"), isJsonObject],
];
