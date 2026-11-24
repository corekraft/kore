import { expect, test } from "vitest";
import { loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// The PostgreSQL service-class flag is registered in every overlay and off in every one:
// it turns on only through `harness flag activate`, after a recorded live outcome (AGENTS.md, It just works).

test("postgresql-service-class-instances is declared off in every overlay", async () => {
  for (const environment of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    expect(
      repository.environment.features?.["postgresql-service-class-instances"],
      environment,
    ).toBe(false);
  }
});
