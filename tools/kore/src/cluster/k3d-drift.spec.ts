import { expect, test } from "vitest";
import type { K3dCluster } from "../config/index.js";
import { drift } from "./k3d-drift.js";

const overlay: K3dCluster = {
  clusterName: "kore-local",
  serviceCidr: "10.96.0.0/12",
  ports: [{ hostAddress: "127.0.0.1", hostPort: 8443, loadBalancerPort: 443 }],
};

/** A cluster entry as `k3d cluster list` reports it, with the given load balancer mappings. */
function entry(
  portMappings: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    serversCount: 1,
    agentsCount: 0,
    nodes:
      portMappings === undefined
        ? []
        : [{ role: "loadbalancer", portMappings }],
    ...overrides,
  };
}

test("a port published on the overlay's host port and address is no difference", () => {
  const matching = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
  });
  expect(drift(matching, overlay)).toEqual([]);
});

test("a port published on the overlay's host port at another address names the address", () => {
  const wide = entry({ "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "8443" }] });
  expect(drift(wide, overlay)).toEqual([
    "port 443 address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("a binding whose host address the list omits reads as unreported, never as loopback", () => {
  const silent = entry({ "443/tcp": [{ HostPort: "8443" }] });
  expect(drift(silent, overlay)).toEqual([
    "port 443 address: unreported != 127.0.0.1",
  ]);
});

test("a port on another host port is named by its port, not by its address", () => {
  const moved = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "9443" }],
  });
  expect(drift(moved, overlay)).toEqual(["port 443: 9443 != 8443"]);
});

test("a container port with no bindings is named unmapped", () => {
  expect(drift(entry({ "443/tcp": [] }), overlay)).toEqual([
    "port 443: unmapped != 8443",
  ]);
});

test("without reported mappings only the counts compare, so a missing mapping list is no port difference", () => {
  expect(drift(entry(undefined, { serversCount: 3 }), overlay)).toEqual([
    "servers: 3 != 1",
  ]);
});

test("an extra mapping such as the random API port is ignored, even when it is off loopback", () => {
  const extra = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    "6443/tcp": [{ HostIp: "0.0.0.0", HostPort: "51234" }],
  });
  expect(drift(extra, overlay)).toEqual([]);
});
