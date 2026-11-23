import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";

// Docs: docs/operations/agentgateway-data-plane-series.md (issue #1514, ADR 0174)

const flag = "agentgateway-data-plane-metrics";

test("every overlay declares the data-plane metrics flag, off, until a live run records its series", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.[flag],
      false,
      `${name} declares the flag off`,
    );
  }
});
