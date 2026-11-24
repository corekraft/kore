import { expect, test } from "vitest";
import { loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0152-one-node-capacity-is-a-declared-budget-that-quotas-enforce-and-memory-favours-the-cluster.md
// The data-path priority class flag (issue 1531) is registered in every overlay and off in every one:
// it turns on only through `harness flag activate`, after a recorded live outcome (AGENTS.md, It just works).

test("data-path-priority-class is declared off in every overlay", async () => {
  for (const environment of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    expect(
      repository.environment.features?.["data-path-priority-class"],
      environment,
    ).toBe(false);
  }
});
