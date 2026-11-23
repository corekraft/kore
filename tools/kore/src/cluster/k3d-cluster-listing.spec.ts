import { expect, test } from "vitest";
import { fakeRepository, fakeRunner, k3dEntry } from "./cluster-support.js";
import { up } from "./k3d-cluster-support.js";

/** The local overlay's entry point: platform-dns publishes host port 443 through the shared node port (ADR 0132, ADR 0176). */
const localEntryPoint = {
  hostAddress: "127.0.0.1",
  hostPort: 443,
  loadBalancerPort: 30443,
  featureFlag: "platform-dns",
};

/** A running cluster created before the 443 cutover: it publishes the removed 8443 mapping and no 443. */
const preCutover = {
  "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
};

test("kore local up refuses a running cluster that lacks the 443 mapping before any create, start or readiness command, naming the mapping and the remedy", async () => {
  const repository = fakeRepository({
    k3d: {
      clusterName: "kore-local",
      serviceCidr: "10.96.0.0/12",
      ports: [localEntryPoint],
    },
    features: { "platform-dns": true },
  });
  // `k3d cluster list` reports the cluster without its load balancer's mappings, as the
  // pre-cutover cluster did in the migration run; docker inspect is the only source of them.
  const { runner, run } = fakeRunner((command, args) => {
    if (command === "k3d" && args[1] === "list") {
      return JSON.stringify([k3dEntry(1)]);
    }
    if (command === "docker") {
      return JSON.stringify(preCutover);
    }
    return "";
  });

  const refusal = up(runner, repository);

  await expect(refusal).rejects.toThrow(
    /port 30443 \(platform-dns\): 8443 != 443/,
  );
  await expect(refusal).rejects.toThrow(/kore local down --prune/);
  await expect(refusal).rejects.toThrow(/then `kore local up`/);
  const commands = run.mock.calls.map(([command, args]) =>
    [command, ...args].join(" "),
  );
  expect(
    commands.filter((line) => /^k3d cluster (create|start)/.test(line)),
  ).toEqual([]);
  expect(commands.filter((line) => line.startsWith("kubectl"))).toEqual([]);
});
