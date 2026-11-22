// Test helpers and expected values for the hc adapter's spec. Not a unit, so no
// spec of its own (ADR 0098). The expected Terminal values are what the adapter
// maps hc 0.1.21's fixtures to.
import { vi, type Mock } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import { HC_0_1_21 } from "./hc-0.1.21.fixtures.js";
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

const LABELS = { "kore-session": "s1", role: "writer" };

export const WRITER_LIVE: Terminal = {
  id: "t7",
  name: "s1",
  parent: "t3",
  state: "live",
  status: "working",
  labels: LABELS,
  cwd: "/work/kore",
};

export const WRITER_FINISHED: Terminal = {
  id: "t7",
  name: "s1",
  parent: "t3",
  state: "finished",
  labels: LABELS,
  cwd: "/work/kore",
  exitCode: 0,
};

export const SIBLING_FINISHED: Terminal = {
  ...WRITER_FINISHED,
  id: "t8",
  name: "s2",
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
    (t) => t.get("t7"),
    ["get", "--json", "t7"],
    HC_0_1_21.get,
    WRITER_FINISHED,
  ],
  [
    "run",
    (t) => t.run({ argv: ["bash"], cwd: "/w", env: {} }),
    ["run", "--json", "--bg", "--cwd", "/w", "--", "bash"],
    HC_0_1_21.run,
    { id: "t7" },
  ],
  [
    "run with notify false: --no-notify before the argv",
    (t) => t.run({ argv: ["bash"], cwd: "/w", parent: "t3", notify: false }),
    [
      "run",
      "--json",
      "--bg",
      "--cwd",
      "/w",
      "--parent",
      "t3",
      "--no-notify",
      "--",
      "bash",
    ],
    HC_0_1_21.run,
    { id: "t7" },
  ],
  [
    "read",
    (t) => t.read("t7", 40),
    ["read", "--json", "--lines", "40", "t7"],
    HC_0_1_21.read,
    { text: "ready\n> ", complete: true },
  ],
  [
    "send",
    (t) => t.send("t7", "-- continue"),
    ["send", "--json", "--", "t7", "-- continue"],
    HC_0_1_21.send,
    { id: "t7" },
  ],
  [
    "interrupt",
    (t) => t.interrupt("t7"),
    ["interrupt", "--json", "t7"],
    HC_0_1_21.interrupt,
    { id: "t7" },
  ],
  [
    "kill",
    (t) => t.kill("t7"),
    ["kill", "--json", "t7"],
    HC_0_1_21.kill,
    { id: "t7" },
  ],
  [
    "remove",
    (t) => t.remove("t7"),
    ["rm", "--json", "t7"],
    HC_0_1_21.remove,
    { id: "t7" },
  ],
  [
    "label",
    (t) => t.label("t7", { model: "sonnet" }),
    ["label", "--json", "t7", "model=sonnet"],
    HC_0_1_21.label,
    { id: "t7" },
  ],
];
