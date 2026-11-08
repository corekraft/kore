import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { platformUp } from "./up.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { RunOptions, RunResult, Runner } from "../runtime/index.js";
import { RecordingRunner } from "../runtime/runner.js";
import { tmpdir } from "node:os";
import { tunnelStatePath } from "../tunnel/tunnel.js";

test("local platform configuration starts the managed Minikube tunnel", async () => {
  const base = await loadRepository("local");
  const root = await mkdtemp(join(tmpdir(), "kore-platform-tunnel-"));
  const repository = { ...base, root };
  repository.catalog.components = [];
  const runner = new RecordingRunner([
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "/tmp/mkcert", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: "", stderr: "", code: 0 },
    { stdout: '{"Host":"Running"}', stderr: "", code: 0 },
    { stdout: "kube-system", stderr: "", code: 0 },
  ]);
  try {
    await platformUp(repository, runner, {
      spawnTunnel: () => 4321,
      isProcessAlive: () => true,
      isPortOpen: async () => true,
    });
    assert.deepEqual(
      await readFile(tunnelStatePath(repository), "utf8").then(JSON.parse),
      { profile: "kore-local", pid: 4321 },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

type Call = { command: string; args: readonly string[] };

function gatewayOrderRunner(calls: Call[]): Runner {
  return {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "kubectl" && args.includes("jsonpath={.metadata.name}")) {
        return { stdout: "kube-system", stderr: "", code: 0 };
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

test("local platform up starts its tunnel before waiting for Gateway programming", async () => {
  const base = await loadRepository("local");
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
    await platformUp(repository, gatewayOrderRunner(calls), {
      spawnTunnel: () => {
        calls.push({ command: "managed-tunnel", args: [] });
        return 4321;
      },
      isProcessAlive: () => true,
      isPortOpen: async () => true,
    });

    const issuerReady = indexOfCall(
      calls,
      ({ command, args }) =>
        command === "kubectl" && args.includes("clusterissuer/kore-local-ca"),
    );
    const tunnelStarted = indexOfCall(
      calls,
      ({ command }) => command === "managed-tunnel",
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
        command === "kubectl" && args.includes("gateway/kore-gateway"),
    );
    assert.ok(issuerReady >= 0);
    assert.ok(configurationApplied > issuerReady);
    assert.ok(tunnelStarted > configurationApplied);
    assert.ok(gatewayProgrammed > tunnelStarted);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("platform up upgrades an already-installed configuration release", async () => {
  const base = await loadRepository("local");
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
      if (command === "mkcert" && args.includes("-CAROOT")) {
        return { stdout: "/tmp/mkcert", stderr: "", code: 0 };
      }
      return { stdout: "kube-system", stderr: "", code: 0 };
    },
  };
  try {
    await platformUp(repository, runner, {
      spawnTunnel: () => 4321,
      isProcessAlive: () => true,
      isPortOpen: async () => true,
    });
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
  const repository = await loadRepository("local");
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(
      command: string,
      args: readonly string[],
      _options?: RunOptions,
    ): Promise<RunResult> {
      calls.push({ command, args });
      if (command === "minikube" && args[0] === "status") {
        return { stdout: '{"Host":"Running"}', stderr: "", code: 0 };
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
      ({ command, args }) => command === "minikube" && args[0] === "start",
    ),
    false,
  );
});
