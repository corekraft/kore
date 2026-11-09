import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformStatus } from "./status.js";

// Docs: docs/decisions/0035-fail-fast-readiness-diagnosis.md
// Registry or verifier unavailability is reported as degraded, naming the cause.

const deployed = JSON.stringify({ info: { status: "deployed" } });

async function only(name: string) {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find((c) => c.name === name)!;
  repository.catalog.components = [{ ...component, dependencies: [] }];
  return repository;
}

interface Cluster {
  /** whether a Deployment has an available replica; false mimics scaled to zero */
  available?: boolean;
  rolloutFails?: boolean;
  /** webhook configuration the apiserver answers with, undefined = not found */
  webhook?: unknown;
  endpointSlices?: unknown;
}

function cluster(state: Cluster) {
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push(`${command} ${args.join(" ")}`);
      const joined = args.join(" ");
      if (command === "helm") {
        return { stdout: deployed, stderr: "", code: 0 };
      }
      if (joined.includes("rollout status")) {
        if (state.rolloutFails) {
          throw new Error("timed out waiting for the rollout to finish");
        }
        return { stdout: "successfully rolled out", stderr: "", code: 0 };
      }
      if (/get deployment\/\S+ --output go-template/.test(joined)) {
        return {
          stdout: state.available ? "available" : "",
          stderr: "",
          code: 0,
        };
      }
      if (joined.includes("webhookconfiguration")) {
        if (state.webhook === undefined) {
          throw new Error('webhookconfigurations "x" not found');
        }
        return { stdout: JSON.stringify(state.webhook), stderr: "", code: 0 };
      }
      if (joined.includes("endpointslices")) {
        return {
          stdout: JSON.stringify(state.endpointSlices ?? { items: [] }),
          stderr: "",
          code: 0,
        };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  return { runner, calls };
}

test("a registry scaled to zero is degraded and names the Deployment, though rollout status passes", async () => {
  const { runner } = cluster({ available: false });

  const [status] = await platformStatus(await only("oci-registry"), runner);

  assert.equal(status?.status, "degraded");
  assert.match(status!.detail, /deployment\/oci-registry/);
  assert.match(status!.detail, /no available replicas/);
});

test("a registry whose rollout does not complete is degraded and names the Deployment", async () => {
  const { runner } = cluster({ rolloutFails: true });

  const [status] = await platformStatus(await only("oci-registry"), runner);

  assert.equal(status?.status, "degraded");
  assert.match(status!.detail, /deployment\/oci-registry not ready/);
});

test("a registry with an available replica is ready", async () => {
  const { runner } = cluster({ available: true });

  const [status] = await platformStatus(await only("oci-registry"), runner);

  assert.equal(status?.status, "ready", status!.detail);
});

test("a policy-controller webhook scaled to zero is degraded and names its Deployment", async () => {
  const { runner } = cluster({ available: false });

  const [status] = await platformStatus(
    await only("policy-controller"),
    runner,
  );

  assert.equal(status?.status, "degraded");
  assert.match(status!.detail, /deployment\/policy-controller-webhook/);
});

const configuration = {
  webhooks: [
    {
      name: "policy.sigstore.dev",
      clientConfig: {
        caBundle: "Zm9v",
        service: { name: "webhook", namespace: "cosign-system" },
      },
    },
  ],
};

test("a policy-controller webhook Service without ready endpoints is degraded and names the Service", async () => {
  const { runner } = cluster({
    available: true,
    webhook: configuration,
    endpointSlices: {
      items: [{ endpoints: [{ conditions: { ready: false } }] }],
    },
  });

  const [status] = await platformStatus(
    await only("policy-controller"),
    runner,
  );

  assert.equal(status?.status, "degraded");
  assert.match(status!.detail, /cosign-system\/webhook/);
  assert.match(status!.detail, /no ready endpoints/);
});

test("a missing policy-controller webhook configuration is degraded", async () => {
  const { runner } = cluster({ available: true, webhook: undefined });

  const [status] = await platformStatus(
    await only("policy-controller"),
    runner,
  );

  assert.equal(status?.status, "degraded");
  assert.match(status!.detail, /webhookconfiguration/);
});

test("status with the registry and verifier down stays read-only", async () => {
  const { runner, calls } = cluster({ available: false });

  await platformStatus(await only("oci-registry"), runner);

  const mutating = calls.filter((call) =>
    /\b(apply|create|delete|patch|upgrade|install|replace|scale)\b/.test(call),
  );
  assert.deepEqual(mutating, []);
});
