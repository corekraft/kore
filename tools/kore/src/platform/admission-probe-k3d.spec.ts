import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { healthyRunner, type Call } from "../app/app-fixtures.js";
import { publishUntrustedCopies } from "./admission-probe.js";

// Docs: docs/decisions/0083-k3d-publishes-through-the-node-containerd-client.md

const source = `10.96.0.50:5000/reference@sha256:${"c".repeat(64)}`;

test("the live admission probe copies reach the registry on k3d through docker exec, never minikube", async () => {
  const base = await loadRepository("local");
  const { cluster: _cluster, ...environment } = base.environment;
  const repository = {
    ...base,
    environment: {
      ...environment,
      provider: "k3d" as const,
      kubeContext: "k3d-kore-local",
      k3d: {
        clusterName: "kore-local",
        serviceCidr: "10.96.0.0/12",
        ports: [{ hostPort: 8443, loadBalancerPort: 443 }],
      },
    },
  };
  const calls: Call[] = [];

  await publishUntrustedCopies(repository, healthyRunner(calls), source, {
    registry: { isPortOpen: async () => true },
    digest: async () => `sha256:${"d".repeat(64)}`,
  });

  expect(calls.map(({ command }) => command)).not.toContain("minikube");
  const pushes = calls.filter(
    ({ command, args }) => command === "docker" && args[0] === "exec",
  );
  expect(pushes).toHaveLength(2);
  expect(JSON.stringify(calls.map((c) => c.args))).not.toContain(
    "push-password",
  );
});
