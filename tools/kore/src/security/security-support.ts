// Fakes and fixtures shared by the security domain's unit specs. A support file is
// not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export type Run = Runner["run"];

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

/** A typed runner whose replies depend on the command and its arguments. */
export function fakeRunner(
  stdout: (command: string, args: readonly string[]) => string = () => "",
) {
  const run = vi.fn<Run>(async (command, args) => ({
    stdout: stdout(command, args),
    stderr: "",
    code: 0,
  }));
  return { runner: { run } as Runner, run };
}

/**
 * A local k3d repository with the fields the security domain reads. Overrides
 * replace the environment's fields, so `fakeRepository({ provider: "managed" })`
 * is the managed case. The one cast stands in for the rest of the overlay
 * (versions, catalog and so on), which these units never read.
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
      gateway: { namespace: "kore-system" },
      secrets: { sourceNamespace: "kore-secret-source" },
      ...environment,
    },
  } as unknown as Repository;
}
