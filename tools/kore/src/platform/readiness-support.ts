// Fakes and fixtures shared by the readiness unit spec. A support file is not a
// unit, so it needs no spec of its own (ADR 0098).
import { vi } from "vitest";
import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";
import { gatewayCheck } from "./readiness-gateway.js";
import { assertIssuerReady, trustRemedy } from "./readiness-issuer.js";
import {
  failureAcrossBounds,
  pause,
  pollUntil,
  retryBudget,
  timeoutMilliseconds,
} from "./readiness-poll.js";
import { waitFor } from "./readiness.js";

export type Run = Runner["run"];

/**
 * The default answers of the readiness collaborators, set before each test: the
 * poll makes one probe and a reason becomes the failure; the bounds run once at
 * the first bound. A test overrides only what it is about.
 */
export function primeReadinessFakes(): void {
  vi.mocked(errorMessage).mockImplementation((error) =>
    error instanceof Error ? error.message : String(error),
  );
  vi.mocked(timeoutMilliseconds).mockReturnValue(1000);
  vi.mocked(gatewayCheck).mockReturnValue(undefined);
  vi.mocked(trustRemedy).mockReturnValue(
    "Run: kore trust install --environment local",
  );
  vi.mocked(assertIssuerReady).mockResolvedValue(undefined);
  vi.mocked(pause).mockResolvedValue(undefined);
  vi.mocked(pollUntil).mockImplementation(async (_timeout, probe) => {
    const reason = await probe();
    if (reason !== undefined) {
      throw new Error(reason);
    }
  });
  vi.mocked(failureAcrossBounds).mockImplementation(async (bounds, attempt) => {
    try {
      await attempt(bounds[0]!);
      return undefined;
    } catch (error) {
      return errorMessage(error);
    }
  });
  vi.mocked(retryBudget).mockReturnValue({ spent: false });
}

/** A typed runner whose stdout (or thrown error) depends on the joined arguments. */
export function fakeRunner(
  reply: (args: readonly string[]) => string | Error = () => "",
) {
  const run = vi.fn<Run>(async (_command, args) => {
    const answer = reply(args);
    if (answer instanceof Error) {
      throw answer;
    }
    return { stdout: answer, stderr: "", code: 0 };
  });
  return { runner: { run } as Runner, run };
}

export const repository = {
  environment: { name: "local", kubeContext: "k3d-kore-local" },
} as unknown as Repository;

/** A component in kore-system with a 10m timeout and no readiness of its own unless given. */
export function component(extra: Record<string, unknown> = {}): Component {
  return {
    name: "web",
    namespace: "kore-system",
    timeout: "10m",
    readiness: [],
    ownsCRDs: [],
    ...extra,
  } as unknown as Component;
}

/** Waits on a component whose readiness is `readiness`, through a typed runner. */
export function waitOn(
  readiness: string[],
  reply?: (args: readonly string[]) => string | Error,
  extra: Record<string, unknown> = {},
) {
  const fake = fakeRunner(reply);
  const wait = () =>
    waitFor(repository, fake.runner, component({ readiness, ...extra }));
  return { ...fake, wait };
}

/** The last three arguments of every kubectl call: the flag or resource, the resource or bound, and the bound. */
export const tails = (run: { mock: { calls: unknown[][] } }) =>
  run.mock.calls.map((call) => (call[1] as string[]).slice(-3));
