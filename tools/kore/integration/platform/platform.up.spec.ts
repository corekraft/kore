// Docs: docs/decisions/0104-integration-specs-may-stub-a-domain-s-own-cluster-facing-modules.md
// Stubs (ADR 0104) the platform's own modules that talk to the cluster:
// ./enrollment.js (namespace labels; covered in enrollment.spec.ts and
// platform.enrollment-order.spec.ts), ./admission-gate.js (gate open and close;
// covered in platform.admission-gate.spec.ts) and ./status.js (the prerequisite
// rows, read from readyRows). It also stubs the images barrel's signing-key
// publish, which is covered in platform.signing-key.spec.ts.
vi.mock("../../src/platform/enrollment.js", () => ({
  enrollPlatformNamespaces: async () => undefined,
}));

vi.mock("../../src/images/index.js", () => ({
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

import { withGatewayFlagsOff } from "../../src/testing/index.js";
import { loadRepository } from "../../src/config/index.js";
import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { nodePortService, runningK3d } from "../../src/testing/index.js";
import { platformUp } from "../../src/platform/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RunOptions, RunResult, Runner } from "../../src/runtime/index.js";
import { tmpdir } from "node:os";

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

function gatewayOrderRunner(calls: Call[]): Runner {
  return {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "k3d") {
        return runningK3d();
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

function indexOfCall(calls: Call[], match: (call: Call) => boolean): number {
  return calls.findIndex(match);
}

test("local platform up waits for Gateway programming after applying the configuration", async () => {
  const base = withGatewayFlagsOff(await loadRepository("local"));
  const root = await mkdtemp(join(tmpdir(), "kore-platform-order-"));
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
    await platformUp(repository, gatewayOrderRunner(calls));

    const issuerReady = indexOfCall(
      calls,
      ({ command, args }) =>
        command === "kubectl" && args.includes("clusterissuer/kore-local-ca"),
    );
    const configurationApplied = indexOfCall(
      calls,
      ({ command, args }) =>
        command === "helm" &&
        args[0] === "upgrade" &&
        args.includes("kore-platform-config"),
    );
    const gatewayProgrammed = indexOfCall(
      calls,
      ({ command, args }) =>
        command === "kubectl" &&
        args.includes("gateway/kore-gateway") &&
        args.includes("json"),
    );
    assert.ok(issuerReady >= 0);
    assert.ok(configurationApplied > issuerReady);
    assert.ok(gatewayProgrammed > configurationApplied);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform up upgrades an already-installed configuration release", async () => {
  const base = withGatewayFlagsOff(await loadRepository("local"));
  const root = await mkdtemp(join(tmpdir(), "kore-platform-upgrade-"));
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
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "helm" && args[0] === "status") {
        return {
          stdout: '{"info":{"status":"deployed"}}',
          stderr: "",
          code: 0,
        };
      }
      if (command === "helm" && args[0] === "history") {
        // Deployed from older desired state than the repository holds now.
        return {
          stdout: JSON.stringify([
            {
              revision: 1,
              status: "deployed",
              description: "kore desired-state sha256:stale",
            },
          ]),
          stderr: "",
          code: 0,
        };
      }
      if (command === "k3d") {
        return runningK3d();
      }
      if (command === "mkcert" && args.includes("-CAROOT")) {
        return { stdout: "/tmp/mkcert", stderr: "", code: 0 };
      }
      return {
        stdout: command === "kubectl" ? kubectlOutput(args) : "kube-system",
        stderr: "",
        code: 0,
      };
    },
  };
  try {
    await platformUp(repository, runner);
    assert.ok(
      calls.some(
        ({ command, args }) =>
          command === "helm" &&
          args[0] === "upgrade" &&
          args.includes("kore-platform-config"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform up refuses a profile whose Kubernetes context is unexpected", async () => {
  const repository = withGatewayFlagsOff(await loadRepository("local"));
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(
      command: string,
      args: readonly string[],
      _options?: RunOptions,
    ): Promise<RunResult> {
      calls.push({ command, args });
      if (command === "k3d") {
        return runningK3d();
      }
      if (command === "kubectl") {
        return { stdout: "wrong-cluster", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };

  await assert.rejects(
    platformUp(repository, runner),
    /expected cluster|context/i,
  );
  assert.equal(
    calls.some(
      ({ command, args }) =>
        command === "k3d" && ["create", "start"].includes(args[1] ?? ""),
    ),
    false,
  );
});
