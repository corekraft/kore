import assert from "node:assert/strict";

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
): ServicePort[] {
  return gatewayClass === "agentgateway"
    ? [{ name: `listener-${port}`, port }]
    : [
        { name: "status-port", port: 15021 },
        { name: "https", port },
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
