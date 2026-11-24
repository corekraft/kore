import { expect, test } from "vitest";
import { loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// The shared gateway proxy defaults flag is registered in every overlay and off in every one:
// it turns on only through `harness flag activate`, after a recorded live outcome (AGENTS.md, It just works).

test("gateway-proxy-defaults is declared off in every overlay", async () => {
  for (const environment of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    expect(
      repository.environment.features?.["gateway-proxy-defaults"],
      environment,
    ).toBe(false);
  }
});
