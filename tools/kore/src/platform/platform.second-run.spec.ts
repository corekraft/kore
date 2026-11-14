import { loadRepository } from "../config/index.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, test, vi } from "vitest";

// Enrollment is covered in enrollment.spec.ts and platform.enrollment-order.spec.ts.
vi.mock("./enrollment.js", () => ({
  enrollPlatformNamespaces: async () => undefined,
}));

vi.mock("../images/index.js", () => ({
  ensureLocalSigningPublicKey: async () => undefined,
}));
// The admission gate is covered in platform.admission-gate.spec.ts.
vi.mock("./admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./admission-gate.js")>()),
  closeExistingAdmissionGate: async () => undefined,
  openAdmissionGate: async () => undefined,
  assertAdmissionGateOpen: async () => "g",
}));
vi.mock("./status.js", async () => {
  const { readyRows } = await import("./readiness-fixtures.js");
  return {
    imageInventoryStatusName: "image-inventory",
    platformStatus: async (repository: Parameters<typeof readyRows>[0]) =>
      readyRows(repository),
  };
});

import type { Runner } from "../runtime/index.js";
import { type RunResult } from "../runtime/index.js";
import { desiredFingerprint } from "./fingerprint.js";
import { platformUp } from "./up.js";
import { nodePortService, runningK3d } from "./k3d-fixtures.js";
import { healthyWebhookOutput } from "../testing/index.js";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

// The releases a second `kore local up` upgraded although nothing had changed.
const configurationReleases = [
  "kore-image-policy",
  "kore-local-tls",
  "opa-authorizer",
  "kore-platform-config",
];

const healthyGateway = JSON.stringify({
  status: {
    conditions: [
      { type: "Accepted", status: "True" },
      { type: "Programmed", status: "True" },
    ],
    listeners: [
      { name: "https", conditions: [{ type: "ResolvedRefs", status: "True" }] },
    ],
  },
});

/** A cluster where the release is deployed with the given description. */
function cluster(description: (revision: number) => string) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "helm" && args[0] === "status") {
        return ok('{"info":{"status":"deployed"}}');
      }
      if (command === "helm" && args[0] === "history") {
        return ok(
          JSON.stringify([
            { revision: 1, status: "superseded", description: description(1) },
            { revision: 2, status: "deployed", description: description(2) },
          ]),
        );
      }
      if (command === "k3d") {
        return runningK3d();
      }
      if (command === "mkcert") {
        return ok("/tmp/mkcert");
      }
      if (command === "kubectl") {
        const webhook = healthyWebhookOutput(args);
        if (webhook !== undefined) {
          return ok(webhook);
        }
        if (args.includes("service")) {
          return ok(nodePortService);
        }
        if (args.some((arg) => arg.startsWith("gateway/"))) {
          return ok(healthyGateway);
        }
        return ok(
          args.includes("jsonpath={.metadata.name}") ? "kube-system" : "ready",
        );
      }
      return ok("kube-system");
    },
  };
  return { calls, runner };
}

async function upOnly(name: string, stale = false) {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-second-run-"));
  temporary.push(root);
  const component = {
    ...base.catalog.components.find((c) => c.name === name)!,
    dependencies: [],
  };
  const repository = {
    ...base,
    root,
    catalog: { ...base.catalog, components: [component] },
  };
  const fingerprint =
    stale || component.kind === "manifest"
      ? "kore desired-state sha256:stale"
      : desiredFingerprint(repository, component);
  const { calls, runner } = cluster(() => fingerprint);
  await platformUp(repository, runner);
  return { calls };
}

const upgrades = (calls: { command: string; args: readonly string[] }[]) =>
  calls.filter((c) => c.command === "helm" && c.args[0] === "upgrade");

for (const name of configurationReleases) {
  test(`a second platform up does not upgrade the unchanged configuration release ${name}`, async () => {
    const { calls } = await upOnly(name);
    assert.deepEqual(upgrades(calls), []);
  });

  test(`platform up still upgrades ${name} when its desired state changed`, async () => {
    const { calls } = await upOnly(name, true);
    assert.equal(upgrades(calls).length, 1);
  });
}

test("an unchanged Gateway release still waits for the Gateway", async () => {
  const { calls } = await upOnly("kore-platform-config");
  assert.deepEqual(upgrades(calls), []);
  assert.ok(
    calls.some(
      (c) => c.command === "kubectl" && c.args.includes("gateway/kore-gateway"),
    ),
  );
});

test("configuration manifests are still applied on every platform up", async () => {
  const { calls } = await upOnly("kore-policy-templates");
  assert.ok(
    calls.some((c) => c.command === "kubectl" && c.args.includes("apply")),
  );
});
