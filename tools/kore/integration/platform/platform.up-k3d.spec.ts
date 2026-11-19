import assert from "node:assert/strict";
import { withGatewayFlagsOff } from "../../src/testing/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";

// Docs: docs/decisions/0104-integration-specs-may-stub-a-domain-s-own-cluster-facing-modules.md
// Stubs (ADR 0104) the platform's own modules that talk to the cluster:
// ./enrollment.js (namespace labels; covered in enrollment.spec.ts),
// ./admission-gate.js (gate open and close; covered in
// platform.admission-gate.spec.ts) and ./status.js (prerequisite rows from
// readyRows). It also stubs the images barrel's signing-key publish, covered in
// platform.signing-key.spec.ts.
vi.mock("../../src/platform/enrollment.js", () => ({
  enrollPlatformNamespaces: async () => undefined,
}));
// ./handover.js stubs only the Argo CD delivery wait, which polls the cluster
// for Applications; local turns platform-argocd-delivery on, and the wait is
// covered in handover.spec.ts. Helm's own reconcile of each release stays real.
vi.mock("../../src/platform/handover.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/platform/handover.js")>()),
  awaitArgocdDelivery: async () => undefined,
}));
vi.mock("../../src/images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/images/index.js")>()),
  ensureLocalSigningPublicKey: async () => undefined,
}));
vi.mock("../../src/platform/admission-gate.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/platform/admission-gate.js")
  >()),
  closeExistingAdmissionGate: async () => undefined,
  openAdmissionGate: async () => undefined,
  assertAdmissionGateOpen: async () => "g",
}));
vi.mock("../../src/platform/status.js", () => ({
  imageInventoryStatusName: "image-inventory",
  // Read lazily: the testing barrel loads this module, so it cannot be read while the factory runs.
  platformStatus: async (
    repository: Parameters<
      typeof import("../../src/testing/index.js").readyRows
    >[0],
  ) => {
    const { readyRows } = await import("../../src/testing/index.js");
    return readyRows(repository);
  },
}));

import { loadRepository } from "../../src/config/index.js";
import type { Runner } from "../../src/runtime/index.js";
import { platformUp } from "../../src/platform/index.js";

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

/** A fresh profile: no Gateway class to read and no Gateway or old proxy left to wait for. */
function freshGatewayRead(args: readonly string[]): boolean {
  return (
    args.includes("jsonpath={.spec.gatewayClassName}") ||
    (args.includes("name") &&
      args.some(
        (arg) =>
          arg === "gateway/kore-gateway" ||
          arg.endsWith("kore-gateway-istio") ||
          arg.includes("gateway-name="),
      ))
  );
}

function kubectlOutput(args: readonly string[]): string {
  if (freshGatewayRead(args)) {
    return "";
  }
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
  const base = withGatewayFlagsOff(await loadRepository("local"));
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
          command === "kubectl" &&
          args.includes("gateway/kore-gateway") &&
          args.includes("json"),
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
