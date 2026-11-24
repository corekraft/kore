import { expect, test } from "vitest";
import { loadRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md
// The external Gateway's limits flag is registered in every overlay and off in every one: it turns on
// only through `harness flag activate`, after a recorded live outcome of the public probe (AGENTS.md, It just works).

test("external-gateway-limits is declared off in every overlay", async () => {
  for (const environment of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(environment);
    expect(
      repository.environment.features?.["external-gateway-limits"],
      environment,
    ).toBe(false);
  }
});
