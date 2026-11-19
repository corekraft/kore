import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { type Repository } from "../../src/config/index.js";
import { helmTemplateArgs } from "../../src/platform/index.js";
import { withAbsoluteChart } from "../../src/testing/index.js";

// Shared by the Gateway Service and database listener integration specs.

export function render(repository: Repository): string {
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

export interface ServicePort {
  name?: string;
  port: number;
  nodePort?: number;
}

// The overlay's ports as rendered, for either class: the ConfigMap's embedded
// Service and the AgentgatewayParameters carry the same `ports:` list.
export function overlayPorts(output: string): ServicePort[] {
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
export function generatedPorts(
  gatewayClass: string,
  port: number,
  databasePort?: number,
): ServicePort[] {
  const database =
    databasePort === undefined
      ? []
      : [
          {
            name:
              gatewayClass === "agentgateway"
                ? `listener-${databasePort}`
                : "postgres",
            port: databasePort,
          },
        ];
  return gatewayClass === "agentgateway"
    ? [{ name: `listener-${port}`, port }, ...database]
    : [
        { name: "status-port", port: 15021 },
        { name: "https", port },
        ...database,
      ];
}

// A Service merges its ports on `port`: a matching entry is updated in place,
// any other is appended as it stands.
export function merge(generated: ServicePort[], overlay: ServicePort[]) {
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
