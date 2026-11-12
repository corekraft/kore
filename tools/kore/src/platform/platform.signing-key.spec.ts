import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import { expect, test, vi } from "vitest";
import { loadRepository } from "../config/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { withHealthyWebhooks } from "./webhook-fixtures.js";

const events = vi.hoisted(() => [] as string[]);

vi.mock("../images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => {
    events.push("public-key");
  },
  ensureRegistryAuth: async () => {
    events.push("registry-auth");
  },
  ensureRegistryTrust: async () => {
    events.push("registry-trust");
  },
  registryTrustProblem: async () => undefined,
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
  const repository = await loadMinikubeLocal();

  await bootstrapControllers(
    repository,
    withHealthyWebhooks(new RecordingRunner()),
  );

  expect(events.at(-1)).toBe("public-key");
  expect(events).toContain("reconcile:policy-controller");
  expect(events).not.toContain("reconcile:kore-image-policy");
});

test("managed environments never publish the local signing key", async () => {
  events.length = 0;
  const repository = await loadRepository("managed-example");

  await bootstrapControllers(
    repository,
    withHealthyWebhooks(new RecordingRunner()),
  );

  expect(events).not.toContain("public-key");
});

test("registry credentials exist before the registry release starts, in every environment", async () => {
  for (const name of ["local", "managed-example"]) {
    events.length = 0;
    const repository = await loadRepository(name);

    await bootstrapControllers(
      repository,
      withHealthyWebhooks(new RecordingRunner()),
    );

    expect(events.indexOf("registry-auth"), name).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("registry-auth"), name).toBeLessThan(
      events.indexOf("reconcile:oci-registry"),
    );
  }
});

test("the registry CA reaches the clients right after the registry is issued and before Policy Controller starts", async () => {
  events.length = 0;
  const repository = await loadMinikubeLocal();

  await bootstrapControllers(
    repository,
    withHealthyWebhooks(new RecordingRunner()),
  );

  const issued = events.indexOf("reconcile:oci-registry");
  const trust = events.indexOf("registry-trust");
  expect(trust).toBeGreaterThan(issued);
  expect(trust).toBeLessThan(events.indexOf("reconcile:policy-controller"));
  expect(events.indexOf("reconcile:cert-manager")).toBeLessThan(issued);
});
