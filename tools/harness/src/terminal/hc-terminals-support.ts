// Test helpers and expected values for the hc adapter's spec. Not a unit, so no
// spec of its own (ADR 0098). The expected Terminal values are what the adapter
// maps hc 0.1.21's fixtures to.
import { vi, type Mock } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import { HC_0_1_21 } from "./hc-0.1.21.fixtures.js";
import type { Terminal } from "./port.js";

export const PIN_INSTALL =
  'install the pinned hc 0.1.21 with "hc update --version 0.1.21" (or "hc update --from <file>" for the exact binary), then confirm with "hc --version"';

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
