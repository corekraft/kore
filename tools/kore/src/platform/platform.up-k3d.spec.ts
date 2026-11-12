import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

// Covered elsewhere: enrollment, the signing key, the admission gate, status.
vi.mock("./enrollment.js", () => ({
  enrollPlatformNamespaces: async () => undefined,
}));
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  ensureLocalSigningPublicKey: async () => undefined,
}));
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

import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { platformUp } from "./up.js";

type Call = { command: string; args: readonly string[] };

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
// What the load balancer fronts: a NodePort Service, never a LoadBalancer address.
const nodePortService = JSON.stringify({
  items: [
    {
      spec: { type: "NodePort", ports: [{ port: 8443, nodePort: 30443 }] },
      status: { loadBalancer: {} },
    },
  ],
});
const runningCluster = JSON.stringify([
  {
    name: "kore-local",
    serversCount: 1,
    serversRunning: 1,
    agentsCount: 0,
    agentsRunning: 0,
  },
]);

function kubectlOutput(args: readonly string[]): string {
  if (args.includes("jsonpath={.metadata.name}")) {
    return "kube-system";
  }
  if (args.includes("service")) {
    return nodePortService;
  }
  return args.includes("gateway/kore-gateway") ? healthyGateway : "";
}

function k3dRunner(calls: Call[]): Runner {
  return {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "k3d") {
        return { stdout: runningCluster, stderr: "", code: 0 };
      }
      if (command === "kubectl") {
        return { stdout: kubectlOutput(args), stderr: "", code: 0 };
      }
      if (command === "mkcert" && args.includes("-CAROOT")) {
        return { stdout: "/tmp/mkcert", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
}

test("platform up on k3d programs the Gateway with no tunnel and no host process", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-platform-k3d-"));
  const platformConfig = base.catalog.components.find(
    ({ name }) => name === "kore-platform-config",
  )!;
  const repository = {
    ...base,
    root,
    catalog: {
      ...base.catalog,
      components: [{ ...platformConfig, dependencies: [] }],
    },
  };
  const calls: Call[] = [];
  try {
    await platformUp(repository, k3dRunner(calls));

    assert.ok(
      calls.some(
        ({ command, args }) =>
          command === "kubectl" && args.includes("gateway/kore-gateway"),
      ),
      "the Gateway is still awaited",
    );
    assert.deepEqual(
      calls.filter(({ command }) => command === "ssh"),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
