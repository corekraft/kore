import { loadMinikubeLocal } from "../config/minikube-local.fixtures.js";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";

import type { Runner } from "../runtime/index.js";
import { healthyWebhookOutput } from "../platform/webhook-fixtures.js";
import { tunnelStatePath, type TunnelDependencies } from "../tunnel/tunnel.js";
import { appStatus } from "./app.js";

// Docs: docs/decisions/0035-fail-fast-readiness-diagnosis.md
// A new managed workload is denied while the registry or signature verifier is
// unavailable; app status says so rather than showing only Helm's view.

async function statusWith(
  down: "none" | "registry" | "verifier",
  tunnel: TunnelDependencies = {
    isProcessAlive: () => true,
    isPortOpen: async () => true,
  },
): Promise<{ status: Record<string, unknown>; calls: string[] }> {
  const base = await loadMinikubeLocal();
  const root = await mkdtemp(join(tmpdir(), "kore-app-status-admission-"));
  await mkdir(join(root, "infra/catalog"), { recursive: true });
  await copyFile(
    join(base.root, "infra/catalog/images.lock.json"),
    join(root, "infra/catalog/images.lock.json"),
  );
  const repository = { ...base, root };
  await mkdir(join(root, ".kore", "state"), { recursive: true });
  await writeFile(
    tunnelStatePath(repository),
    JSON.stringify({ profile: "kore-local", pid: 4321 }),
  );
  const calls: string[] = [];
  const runner: Runner = {
    async run(command, args) {
      const joined = args.join(" ");
      calls.push(`${command} ${joined}`);
      const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
      if (command === "helm") {
        return ok('{"info":{"status":"deployed"}}');
      }
      if (
        down === "registry" &&
        joined.includes("--namespace kore-registry") &&
        joined.includes("availableReplicas")
      ) {
        return ok("");
      }
      if (
        down === "verifier" &&
        joined.includes("--namespace cosign-system") &&
        joined.includes("availableReplicas")
      ) {
        return ok("");
      }
      const healthy = healthyWebhookOutput(args);
      if (healthy !== undefined) {
        return ok(healthy);
      }
      return ok("kube-system");
    },
  };
  try {
    return {
      status: await appStatus(repository, runner, "reference", tunnel),
      calls,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("app status reports ready when the registry and verifier are available", async () => {
  const { status } = await statusWith("none");

  assert.equal(status["status"], "ready");
  assert.deepEqual(status["degraded"], []);
});

test("app status reports degraded and names the registry when it is unavailable", async () => {
  const { status } = await statusWith("registry");

  assert.equal(status["status"], "degraded");
  const degraded = status["degraded"] as {
    component: string;
    detail: string;
  }[];
  assert.deepEqual(
    degraded.map(({ component }) => component),
    ["oci-registry"],
  );
  assert.match(degraded[0]!.detail, /deployment\/oci-registry/);
});

test("app status reports degraded and names the policy controller when the verifier is unavailable", async () => {
  const { status } = await statusWith("verifier");

  assert.equal(status["status"], "degraded");
  const degraded = status["degraded"] as {
    component: string;
    detail: string;
  }[];
  assert.deepEqual(
    degraded.map(({ component }) => component),
    ["policy-controller"],
  );
  assert.match(degraded[0]!.detail, /policy-controller-webhook/);
});

test("app status stays read-only while reporting degraded", async () => {
  const { calls } = await statusWith("registry");

  const mutating = calls.filter((call) =>
    /\b(apply|create|delete|patch|upgrade|install|replace|scale|label)\b/.test(
      call,
    ),
  );
  assert.deepEqual(mutating, []);
});

test("app status reports degraded with the remedy when the tunnel has exited, without restarting it", async () => {
  const { status, calls } = await statusWith("none", {
    isProcessAlive: () => false,
    isPortOpen: async () => false,
    spawnTunnel: () => assert.fail("status must not start a tunnel"),
  });

  assert.equal(status["status"], "degraded");
  const degraded = status["degraded"] as {
    component: string;
    detail: string;
  }[];
  assert.deepEqual(
    degraded.map(({ component }) => component),
    ["local-tunnel"],
  );
  assert.match(degraded[0]!.detail, /kore tunnel start --environment local/);
  const tunnel = status["tunnel"] as { status: string; detail: string };
  assert.equal(tunnel.status, "degraded");
  assert.match(tunnel.detail, /kore tunnel start --environment local/);
  assert.ok(!calls.some((call) => call.startsWith("minikube tunnel")));
});
