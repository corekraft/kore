import { expect, test, vi } from "vitest";
import { loadRepository } from "../config/index.js";
import { RecordingRunner } from "../runtime/runner.js";

const events = vi.hoisted(() => [] as string[]);

vi.mock("../images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => {
    events.push("public-key");
  },
  ensureRegistryAuth: async () => {
    events.push("registry-auth");
  },
}));
vi.mock("../cluster/index.js", () => ({
  assertExpectedCluster: async () => undefined,
  ClusterUnavailableError: class extends Error {},
  clusterUp: async () => undefined,
}));
vi.mock("./reconcile.js", () => ({
  reconcileIfNeeded: async (_r: unknown, _n: unknown, c: { name: string }) => {
    events.push(`reconcile:${c.name}`);
  },
}));

import { bootstrapControllers } from "./bootstrap.js";

test("the public signing key Secret exists once Policy Controller is installed and before configuration starts", async () => {
  events.length = 0;
  const repository = await loadRepository("local");

  await bootstrapControllers(repository, new RecordingRunner());

  expect(events.at(-1)).toBe("public-key");
  expect(events).toContain("reconcile:policy-controller");
  expect(events).not.toContain("reconcile:kore-image-policy");
});

test("managed environments never publish the local signing key", async () => {
  events.length = 0;
  const repository = await loadRepository("managed-example");

  await bootstrapControllers(repository, new RecordingRunner());

  expect(events).not.toContain("public-key");
});

test("registry credentials exist before the registry release starts, in every environment", async () => {
  for (const name of ["local", "managed-example"]) {
    events.length = 0;
    const repository = await loadRepository(name);

    await bootstrapControllers(repository, new RecordingRunner());

    expect(events.indexOf("registry-auth"), name).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("registry-auth"), name).toBeLessThan(
      events.indexOf("reconcile:oci-registry"),
    );
  }
});
