// Fakes shared by the images domain's unit specs. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import { vi, type MockedFunction } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner, RunResult } from "../runtime/index.js";

/** A typed runner: `stdout` chooses the reply from the arguments; every call is recorded on `run`. */
export function fakeRunner(
  stdout: (args: readonly string[]) => string = () => "",
): { runner: Runner; run: MockedFunction<Runner["run"]> } {
  const run = vi.fn<Runner["run"]>(
    async (_command, args): Promise<RunResult> => ({
      stdout: stdout(args),
      stderr: "",
      code: 0,
    }),
  );
  return { runner: { run }, run };
}

/**
 * A repository with the fields the images units read. The one cast stands in
 * for the rest of the overlay, which these units never read.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  root = "/repo",
): Repository {
  return {
    root,
    environment: {
      name: "local",
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      ...environment,
    },
  } as unknown as Repository;
}
