import { expect, test } from "vitest";
import { flagEntry, loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// The database-role-split flag is registered in every overlay and off in every one: it turns on only
// through `harness flag activate`, after a recorded live outcome (AGENTS.md, It just works).

test("database-role-split is declared off in every overlay", async () => {
  for (const environment of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    expect(
      repository.environment.features?.["database-role-split"],
      environment,
    ).toBe(false);
  }
});

test("database-role-split is a feature flag that applies to every overlay that declares it", async () => {
  const { flags } = await loadRepository("local");
  const entry = flagEntry(flags, "database-role-split");
  expect(entry?.kind).toBe("feature");
  expect(entry?.applies).toEqual(["local", "vps", "managed-example"]);
});
