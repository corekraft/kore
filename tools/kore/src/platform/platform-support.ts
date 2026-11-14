// Fakes shared by the platform domain's unit specs for the bootstrap, lifecycle,
// up, reconcile, Helm, enrollment and patch units. A support file is not a unit,
// so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export type Run = Runner["run"];

/** A Helm catalog component with every required field set; overrides replace any field. */
export function fakeComponent(overrides: Partial<Component> = {}): Component {
  return {
    name: "reference",
    phase: "core",
    namespace: "reference",
    kind: "helm",
    repository: "oci://registry.example/charts",
    chart: "reference",
    version: "1.2.3",
    ownsCRDs: [],
    dependencies: [],
    timeout: "10m",
    readiness: [],
    ...overrides,
  };
}

/** A typed runner whose stdout depends on the command and its arguments. */
export function fakeRunner(
  reply: (command: string, args: readonly string[]) => string = () => "",
) {
  const run = vi.fn<Run>(async (command, args) => ({
    stdout: reply(command, args),
    stderr: "",
    code: 0,
  }));
  const runner: Runner = { run };
  return { runner, run };
}

/**
 * A k3d repository with the fields the platform units read. Overrides replace
 * the environment's fields, so `fakeRepository({ provider: "managed" })` is the
 * managed case. The one cast stands in for the rest of the overlay (versions,
 * catalog and so on), which these units never read.
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
