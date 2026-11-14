// Fakes shared by the runtime domain's unit specs. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Runner } from "./runner.js";

export type Run = Runner["run"];

/**
 * A typed runner that records every call. It replies with `exit 0` and no
 * output unless `reply` says otherwise.
 */
export function fakeRunner(
  reply: Run = async () => ({ stdout: "", stderr: "", code: 0 }),
) {
  const run = vi.fn<Run>(reply);
  return { runner: { run } as Runner, run };
}
