// Fakes and fixtures shared by the cli domain's unit specs. A support file is
// not a unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { CommandContext, Mutate } from "./context.js";
import type { ParsedArgs } from "./flags.js";

/** Parsed arguments with the given flags and positional arguments. */
export function parsedArgs(
  flags: Record<string, string | boolean> = {},
  positional: string[] = [],
): ParsedArgs {
  return { positional, flags: new Map(Object.entries(flags)) };
}

/** A typed runner: the command handlers only pass it on, never call it. */
export function fakeRunner(): Runner {
  return { run: vi.fn() } as unknown as Runner;
}

/**
 * The runner a context gets when a spec does not name one. Specs that assert
 * on the runner a handler received use this same object, so identity matches.
 */
export const sharedRunner: Runner = fakeRunner();

/**
 * A repository with the fields the cli units read. The one cast stands in for
 * the rest of the overlay (catalog, versions and so on), which these units
 * never read.
 */
export function fakeRepository(
  environment: Record<string, unknown> = {},
  root = "/repo",
): Repository {
  return {
    root,
    catalog: { components: [] },
    environment: {
      name: "local",
      kubeContext: "k3d-kore-local",
      gateway: { name: "kore-gateway" },
      ...environment,
    },
  } as unknown as Repository;
}

/**
 * A command context whose mutate runs its work at once with the given runner,
 * so a handler's mutation is visible to the test without a lock or journal.
 */
export function fakeContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  const runner = overrides.runner ?? sharedRunner;
  const mutate = vi.fn<Mutate>(async (_label, work) => work(runner));
  return {
    command: "local",
    action: "up",
    parsed: parsedArgs(),
    repository: fakeRepository(),
    environmentName: "local",
    runner,
    json: false,
    mutate,
    ...overrides,
  };
}
