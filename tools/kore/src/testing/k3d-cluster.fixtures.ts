import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRepository } from "../config/index.js";
import type { Repository } from "../config/index.js";
import type { RunResult, Runner } from "../runtime/index.js";
import { CommandError } from "../runtime/index.js";

export async function k3dRepository(): Promise<Repository> {
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

export const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });
export const entry = (
  running: number,
  overrides: Record<string, unknown> = {},
) => ({
  name: "kore-local",
  token: "SECRET-TOKEN",
  serversCount: 1,
  serversRunning: running,
  agentsCount: 0,
  agentsRunning: 0,
  hasLoadBalancer: true,
  ...overrides,
});
export const list = (
  running: number | undefined,
  overrides: Record<string, unknown> = {},
): string =>
  JSON.stringify(running === undefined ? [] : [entry(running, overrides)]);

/** A fake runner: k3d list reports `running` servers; kubectl answers ready. */
export function fakeRunner(
  initial: number | undefined,
  kubectlFails = false,
  overrides: Record<string, unknown> = {},
) {
  let running = initial;
  let current = overrides;
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (command === "k3d" && ["create", "start"].includes(args[1] ?? "")) {
        running = 1;
        current = {
          ...current,
          serversRunning: current["serversCount"] ?? 1,
          agentsRunning: current["agentsCount"] ?? 0,
        };
      }
      if (command === "k3d" && args[1] === "list") {
        return ok(list(running, current));
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

export const text = (calls: { command: string; args: readonly string[] }[]) =>
  calls.map((call) => `${call.command} ${call.args.join(" ")}`);

export const fast = { sleep: async () => undefined };

/** A throwaway home for the k3d trust directory; removed when the worker exits. */
export const testHome = mkdtempSync(join(tmpdir(), "kore-k3d-home-"));
process.on("exit", () => rmSync(testHome, { recursive: true, force: true }));

/** The registry trust volumes `k3d cluster create` receives under `testHome`. */
export const trustVolumeArgs = (): string[] => {
  const directory = join(
    testHome,
    ".kore",
    "k3d",
    "kore-local",
    "registry-trust",
  );
  return [
    "--volume",
    `${directory}:/etc/kore/registry-ca@all`,
    "--volume",
    `${directory}/registries.yaml:/etc/rancher/k3s/registries.yaml@all`,
  ];
};
