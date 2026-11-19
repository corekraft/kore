import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import {
  componentValues,
  loadRepository,
  platformDnsFlag,
  platformHelmArgs,
  validateRepository,
} from "../../src/config/index.js";

// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md

const run = promisify(execFile);
const dnsPort = 1053;

async function renderedService(): Promise<string> {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-dns",
  );
  assert.ok(component);
  const valueFiles = componentValues(repository, component).flatMap((file) => [
    "--values",
    join(repository.root, file),
  ]);
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-dns",
    join(repository.root, "infra/charts/platform-dns"),
    "--namespace",
    component.namespace,
    ...platformHelmArgs(repository.environment, "kore-platform-dns"),
    ...valueFiles,
  ]);
  const service = stdout
    .split(/^---$/m)
    .find((d) => /^kind: Service$/m.test(d));
  assert.ok(service);
  return service;
}

test("the local overlay publishes port 1053 on the loopback address over TCP and UDP", async () => {
  const { environment } = await loadRepository("local");
  const mappings = (environment.k3d?.ports ?? []).filter(
    (p) => p.hostPort === dnsPort,
  );
  assert.deepEqual(
    mappings.map(({ hostAddress, hostPort, protocol, featureFlag }) => ({
      hostAddress,
      hostPort,
      protocol,
      featureFlag,
    })),
    [
      {
        hostAddress: "127.0.0.1",
        hostPort: dnsPort,
        protocol: "tcp",
        featureFlag: platformDnsFlag,
      },
      {
        hostAddress: "127.0.0.1",
        hostPort: dnsPort,
        protocol: "udp",
        featureFlag: platformDnsFlag,
      },
    ],
  );
});

test("the DNS Service publishes the node port each load balancer mapping forwards to, for both protocols", async () => {
  const { environment } = await loadRepository("local");
  const mappings = (environment.k3d?.ports ?? []).filter(
    (p) => p.hostPort === dnsPort,
  );
  const service = await renderedService();
  assert.match(service, /type: NodePort/);
  assert.equal(mappings.length, 2);
  for (const { loadBalancerPort, protocol } of mappings) {
    assert.match(
      service,
      new RegExp(
        `name: dns-${protocol}\\s+port: 53\\s+targetPort: dns-${protocol}\\s+protocol: ${(protocol ?? "tcp").toUpperCase()}\\s+nodePort: ${loadBalancerPort}\\b`,
      ),
      `${protocol} node port ${loadBalancerPort}`,
    );
  }
});

test("the Service stays cluster-internal where no overlay publishes a node port", async () => {
  const repository = await loadRepository("local");
  const { stdout } = await run("helm", [
    "template",
    "kore-platform-dns",
    join(repository.root, "infra/charts/platform-dns"),
    "--set-string",
    "zone=example.test",
  ]);
  assert.match(stdout, /type: ClusterIP/);
  assert.doesNotMatch(stdout, /nodePort/);
});

test("the platform-dns namespace is exempt from image enrollment with a reason, and the overlay still validates", async () => {
  const repository = await loadRepository("local");
  await validateRepository(repository);
  const reason = repository.environment.enrollmentExemptions?.["kore-dns"];
  assert.ok(reason && reason.trim() !== "");
  assert.match(reason, /DNS/);
});
