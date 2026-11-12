import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Repository } from "../config/index.js";
import type { RunResult, Runner } from "../runtime/index.js";
import { CommandError } from "../runtime/index.js";
import {
  assertExpectedCluster,
  ClusterUnavailableError,
  clusterStatus,
  clusterUp,
} from "./cluster.js";

async function k3dRepository(): Promise<Repository> {
  const base = await loadRepository("local");
  const { cluster: _cluster, ...rest } = base.environment;
  return {
    ...base,
    environment: {
      ...rest,
      provider: "k3d",
      kubeContext: "k3d-kore-local",
      k3d: {
        clusterName: "kore-local",
        serviceCidr: "10.96.0.0/12",
        ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
      },
    },
  };
}

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });
const list = (running: number | undefined): string =>
  JSON.stringify(
    running === undefined
      ? []
      : [{ name: "kore-local", serversCount: 1, serversRunning: running }],
  );

/** A fake runner: k3d list reports `running` servers; kubectl answers ready. */
function fakeRunner(initial: number | undefined, kubectlFails = false) {
  let running = initial;
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "k3d" && ["create", "start"].includes(args[1] ?? "")) {
        running = 1;
      }
      if (command === "k3d" && args[1] === "list") {
        return ok(list(running));
      }
      if (command === "kubectl" && kubectlFails) {
        throw new CommandError(command, args, {
          stdout: "",
          stderr: "connection refused",
          code: 1,
        });
      }
      if (args.some((arg) => arg.startsWith("jsonpath={range"))) {
        return ok("k3d-kore-local-server-0=True\n");
      }
      if (args.some((arg) => arg.startsWith("jsonpath={.metadata"))) {
        return ok("kube-system");
      }
      return ok("ok");
    },
  };
  return { runner, calls };
}

const text = (calls: { command: string; args: readonly string[] }[]) =>
  calls.map((call) => `${call.command} ${call.args.join(" ")}`);

const fast = { sleep: async () => undefined };

test("cluster up on an absent k3d cluster lists, creates with the pinned flags, then waits for readiness", async () => {
  const repository = await k3dRepository();
  const { runner, calls } = fakeRunner(undefined);

  await clusterUp(repository, runner, fast);

  const create = calls.find((call) => call.args[1] === "create");
  expect(create?.command).toBe("k3d");
  expect(create?.args).toEqual([
    "cluster",
    "create",
    "kore-local",
    "--image",
    "rancher/k3s:v1.37.2-k3s1@sha256:21ea6e0fac4e3930c2ce8aa40ddd41a8b18cb3e9a0222c030dc005e7e88c4332",
    "--servers",
    "1",
    "--agents",
    "0",
    "--k3s-arg",
    "--disable=traefik@server:*",
    "--k3s-arg",
    "--disable=servicelb@server:*",
    "--k3s-arg",
    "--service-cidr=10.96.0.0/12@server:*",
    "--port",
    "8443:443@loadbalancer",
    "--kubeconfig-update-default=true",
    "--kubeconfig-switch-context=false",
    "--wait",
  ]);
  const lines = text(calls);
  expect(lines[0]).toBe("k3d cluster list --output json");
  expect(lines.some((line) => line.includes("cluster start"))).toBe(false);
  const readyz = lines.findIndex((line) => line.includes("get --raw /readyz"));
  expect(readyz).toBeGreaterThan(lines.indexOf(text([create!])[0] as string));
});

test("cluster up on a stopped k3d cluster starts it and waits for readiness without creating", async () => {
  const repository = await k3dRepository();
  const { runner, calls } = fakeRunner(0);

  await clusterUp(repository, runner, fast);

  const lines = text(calls);
  expect(lines).toContain("k3d cluster start kore-local --wait");
  expect(lines.some((line) => line.includes("cluster create"))).toBe(false);
  expect(
    lines.findIndex((line) => line.includes("get --raw /readyz")),
  ).toBeGreaterThan(lines.indexOf("k3d cluster start kore-local --wait"));
});

test("cluster up on a running k3d cluster neither creates nor starts it but still checks readiness", async () => {
  const repository = await k3dRepository();
  const { runner, calls } = fakeRunner(1);

  await clusterUp(repository, runner, fast);

  const lines = text(calls);
  expect(lines.some((line) => /cluster (create|start)/.test(line))).toBe(false);
  expect(lines.some((line) => line.includes("get --raw /readyz"))).toBe(true);
});

test("a k3d environment never issues a Minikube command or uses the current context", async () => {
  const repository = await k3dRepository();
  for (const running of [undefined, 0, 1]) {
    const { runner, calls } = fakeRunner(running);
    await clusterUp(repository, runner, fast);
    await clusterStatus(repository, runner);
    expect(calls.some((call) => call.command === "minikube")).toBe(false);
    for (const call of calls.filter((c) => c.command === "kubectl")) {
      expect(call.args.slice(0, 2)).toEqual(["--context", "k3d-kore-local"]);
    }
  }
});

test("a readiness timeout after create names what was not ready and says nothing was applied", async () => {
  const repository = await k3dRepository();
  const { runner } = fakeRunner(undefined, true);
  let now = 0;

  await expect(
    clusterUp(repository, runner, {
      timeoutMs: 10_000,
      now: () => now,
      sleep: async (ms) => void (now += ms),
    }),
  ).rejects.toThrow(
    /k3d-kore-local.*API server \(\/readyz\).*connection refused.*Nothing was applied.*k3d cluster list kore-local/s,
  );
});

test("expected-cluster refuses a configured context that is not the one k3d creates", async () => {
  const repository = await k3dRepository();
  const mismatched = {
    ...repository,
    environment: { ...repository.environment, kubeContext: "other-context" },
  };
  const { runner, calls } = fakeRunner(1);

  await expect(assertExpectedCluster(mismatched, runner)).rejects.toThrow(
    /refusing unexpected cluster\/context pair: k3d-kore-local != other-context/,
  );
  expect(calls).toEqual([]);
});

test("expected-cluster rejects a context that identifies another cluster", async () => {
  const repository = await k3dRepository();
  const runner: Runner = {
    async run(command) {
      return command === "k3d" ? ok(list(1)) : ok("default");
    },
  };
  await expect(assertExpectedCluster(repository, runner)).rejects.toThrow(
    /did not identify the expected cluster/,
  );
});

test("a stopped or absent k3d cluster raises the unavailable error naming the cluster and the remedy", async () => {
  const repository = await k3dRepository();
  for (const running of [0, undefined]) {
    const { runner } = fakeRunner(running);
    for (const act of [
      () => assertExpectedCluster(repository, runner),
      () => clusterStatus(repository, runner),
    ]) {
      const error: unknown = await act().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ClusterUnavailableError);
      expect((error as Error).message).toContain("kore-local");
      expect((error as Error).message).toContain("kore local up");
    }
  }
});

test("cluster status reports the k3d cluster, context, environment and state", async () => {
  const repository = await k3dRepository();
  const { runner } = fakeRunner(1);

  const status = await clusterStatus(repository, runner);

  expect(status).toMatchObject({
    environment: "local",
    cluster: "kore-local",
    context: "k3d-kore-local",
    state: "running",
  });
  expect(JSON.parse(JSON.stringify(status))).toEqual(status);
});

test("an unreadable k3d list names the failing command instead of treating the cluster as absent", async () => {
  const repository = await k3dRepository();
  const runner: Runner = {
    async run() {
      return ok("not json");
    },
  };
  await expect(clusterUp(repository, runner, fast)).rejects.toThrow(
    /k3d cluster list --output json printed unreadable output, not JSON/,
  );
});

test("a failing k3d list is reported as the unavailable error naming the remedy, in status and expected-cluster checks", async () => {
  const repository = await k3dRepository();
  const runner: Runner = {
    async run(command, args) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "docker not running",
        code: 1,
      });
    },
  };
  for (const act of [
    () => clusterStatus(repository, runner),
    () => assertExpectedCluster(repository, runner),
  ]) {
    const error: unknown = await act().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClusterUnavailableError);
    expect((error as Error).message).toMatch(/kore-local.*install k3d/);
  }
});
