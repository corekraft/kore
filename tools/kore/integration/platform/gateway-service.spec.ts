import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import {
  ingressFlag,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

function render(repository: Repository): string {
  const component = repository.catalog.components.find(
    (c) => c.name === "kore-platform-config",
  )!;
  return execFileSync(
    "helm",
    withAbsoluteChart(
      repository,
      component,
      helmTemplateArgs(repository, component),
    ),
    { cwd: repository.root, encoding: "utf8" },
  );
}

function withSharedGateway(repository: Repository, on: boolean): Repository {
  return {
    ...repository,
    environment: {
      ...repository.environment,
      features: {
        ...repository.environment.features,
        "platform-shared-gateway": on,
      },
    },
  };
}

// Flag off: the Service keeps the listener port. Flag on: the Service exposes
// the standard port 443 and reaches the unchanged listener through targetPort.
test.each([false, true])(
  "the local overlay publishes the Gateway Service as a NodePort the load balancer maps, with platform-shared-gateway %s",
  async (on) => {
    const repository = withSharedGateway(await loadRepository("local"), on);
    const { k3d, gateway } = repository.environment;
    const output = render(repository);
    assert.match(output, /parametersRef:/);
    assert.match(output, /type: NodePort/);
    const mapped = k3d?.ports.find((p) => p.hostPort === gateway.port);
    assert.ok(mapped, "the k3d block maps the Gateway host port");
    const servicePort = on ? 443 : gateway.port;
    const target = on
      ? `\\s+name: https-standard\\s+targetPort: ${gateway.port}`
      : "";
    assert.match(
      output,
      new RegExp(
        `port: ${servicePort}${target}\\s+nodePort: ${mapped.loadBalancerPort}`,
      ),
    );
    assert.equal(/targetPort/.test(output), on);
  },
);

test("an overlay that sets no Gateway service leaves the chart's Gateway untouched", async () => {
  const repository = await loadRepository("managed-example");
  const output = render(repository);
  assert.doesNotMatch(output, /parametersRef/);
  assert.doesNotMatch(output, /NodePort/);
});

test("the platform chart stays provider-neutral about k3d", async () => {
  const repository = await loadRepository("local");
  const chart = `${repository.root}/infra/charts/platform-config`;
  for (const file of [
    "values.yaml",
    "templates/gateway.yaml",
    "templates/gateway-service.yaml",
  ]) {
    assert.doesNotMatch(await readFile(`${chart}/${file}`, "utf8"), /k3d/i);
  }
});

interface ServicePort {
  name?: string;
  port: number;
  nodePort?: number;
}

// The overlay's ports as rendered, for either class: the ConfigMap's embedded
// Service and the AgentgatewayParameters carry the same `ports:` list.
function overlayPorts(output: string): ServicePort[] {
  const block = /\n\s+ports:\n((?:\s+(?:- )?\w+: [^\n]+\n)+)/.exec(output);
  assert.ok(block, "the overlay declares ports");
  return block[1]!
    .split(/^\s+- /m)
    .filter((entry) => entry.trim() !== "")
    .map((entry) => {
      const field = (key: string) =>
        new RegExp(`(?:^|\\s)${key}: (\\S+)`).exec(`\n${entry}`)?.[1];
      const name = field("name");
      const nodePort = field("nodePort");
      return {
        ...(name === undefined ? {} : { name }),
        port: Number(field("port")),
        ...(nodePort === undefined ? {} : { nodePort: Number(nodePort) }),
      };
    });
}

// What each controller generates for the Gateway's listeners before the overlay
// merges in. agentgateway v1.7.0 makes one port per port number, named
// `listener-<port>`; Istio 1.31.4 makes one per port number too, named after the
// first listener on it, beside its own status-port.
function generatedPorts(gatewayClass: string, port: number): ServicePort[] {
  return gatewayClass === "agentgateway"
    ? [{ name: `listener-${port}`, port }]
    : [
        { name: "status-port", port: 15021 },
        { name: "https", port },
      ];
}

// A Service merges its ports on `port`: a matching entry is updated in place,
// any other is appended as it stands.
function merge(generated: ServicePort[], overlay: ServicePort[]) {
  const merged = generated.map((p) => ({ ...p }));
  for (const entry of overlay) {
    const match = merged.find((p) => p.port === entry.port);
    if (match) {
      Object.assign(match, entry);
    } else {
      merged.push({ ...entry });
    }
  }
  return merged;
}

test.each([
  ["agentgateway", false],
  ["agentgateway", true],
  ["istio", false],
  ["istio", true],
])(
  "the merged Gateway Service names every port and keeps the node port, with the %s class and platform-shared-gateway %s",
  async (gatewayClass, on) => {
    const base = withSharedGateway(await loadRepository("local"), on);
    const repository = {
      ...base,
      environment: {
        ...base.environment,
        features: {
          ...base.environment.features,
          [ingressFlag]: gatewayClass === "agentgateway",
        },
      },
    };
    const output = render(repository);
    assert.match(
      output,
      new RegExp(
        gatewayClass === "agentgateway"
          ? "kind: AgentgatewayParameters"
          : "kind: ConfigMap\\s+metadata:\\s+name: kore-gateway-service",
      ),
    );
    const merged = merge(
      generatedPorts(gatewayClass, repository.environment.gateway.port),
      overlayPorts(output),
    );
    assert.deepEqual(
      merged.filter((p) => !p.name),
      [],
      "every Service port needs a name once the Service has more than one",
    );
    assert.equal(
      new Set(merged.map((p) => p.name)).size,
      merged.length,
      "port names are unique",
    );
    assert.ok(merged.some((p) => p.nodePort !== undefined));
  },
);
