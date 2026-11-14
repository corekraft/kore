// Fakes and fixtures shared by the admission probe unit spec. A support file is
// not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

export const DIGEST = "d".repeat(64);
export const IMAGE = `registry.example:5000/app@sha256:${DIGEST}`;
export const repository = {
  environment: { name: "local", kubeContext: "k3d-kore-local" },
} as unknown as Repository;

/** A typed runner answering every call with `stdout`, or throwing `failure`. */
export function fakeRunner(stdout = "", failure?: unknown) {
  const run = vi.fn<Runner["run"]>(async () => {
    if (failure !== undefined) {
      throw failure;
    }
    return { stdout, stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

/** A kubectl failure whose stderr is the given text. */
export function refusal(stderr: string): CommandError {
  return new CommandError("kubectl", [], { stdout: "", stderr, code: 1 });
}
