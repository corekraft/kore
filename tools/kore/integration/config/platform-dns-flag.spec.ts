import assert from "node:assert/strict";
import { test } from "vitest";
import {
  featureEnabled,
  loadRepository,
  platformDnsFlag,
  validateRepository,
} from "../../src/config/index.js";

test("managed-example declares platform-dns off, so the local DNS component is never installed and ExternalDNS keeps the names (ADR 0042)", async () => {
  const repository = await loadRepository("managed-example");
  await validateRepository(repository);
  assert.equal(repository.environment.features?.[platformDnsFlag], false);
  assert.equal(featureEnabled(repository.environment, platformDnsFlag), false);
});

test("local declares platform-dns off until its live proof is recorded, so no DNS component is installed", async () => {
  const repository = await loadRepository("local");
  await validateRepository(repository);
  assert.equal(repository.environment.features?.[platformDnsFlag], false);
  assert.equal(featureEnabled(repository.environment, platformDnsFlag), false);
});
