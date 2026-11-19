import { expect, test } from "vitest";
import type { K3dCluster } from "../config/index.js";
import { drift, unreadableMessage, unreadablePorts } from "./k3d-drift.js";

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

test("a listed binding that omits its host address is unreadable from the listing, and docker inspect supplies the address that is then compared", () => {
  const silent = entry({ "443/tcp": [{ HostPort: "8443" }] });
  expect(unreadablePorts(silent, overlay)).toEqual(overlay.ports);
  const inspected = { "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }] };
  expect(unreadablePorts(silent, overlay, inspected)).toEqual([]);
  expect(drift(silent, overlay, inspected)).toEqual([]);
  const wideInspected = {
    "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "8443" }],
  };
  expect(drift(silent, overlay, wideInspected)).toEqual([
    "port 443 address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("a listing that reports the host address is readable without docker inspect", () => {
  const listed = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
  });
  expect(unreadablePorts(listed, overlay)).toEqual([]);
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

test("an extra mapping that is not the API port is ignored, even when it is off loopback", () => {
  const extra = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    "9090/tcp": [{ HostIp: "0.0.0.0", HostPort: "51234" }],
  });
  expect(drift(extra, overlay)).toEqual([]);
});

test("the API port's random host port is not compared, but its address is: on the overlay's address it is no difference", () => {
  const api = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    "6443/tcp": [{ HostIp: "127.0.0.1", HostPort: "51234" }],
  });
  expect(drift(api, overlay)).toEqual([]);
});

test("an API port published on every interface is refused naming its address, whatever host port k3d chose", () => {
  const wide = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    "6443/tcp": [{ HostIp: "0.0.0.0", HostPort: "59290" }],
  });
  expect(drift(wide, overlay)).toEqual([
    "port 6443 address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("an API port whose address the listing omits is unreadable until docker inspect supplies it, and then compared", () => {
  const silent = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    "6443/tcp": [{ HostPort: "51234" }],
  });
  expect(unreadablePorts(silent, overlay)).toEqual([
    { hostAddress: "127.0.0.1", loadBalancerPort: 6443 },
  ]);
  const inspected = {
    "6443/tcp": [{ HostIp: "0.0.0.0", HostPort: "51234" }],
  };
  expect(unreadablePorts(silent, overlay, inspected)).toEqual([]);
  expect(drift(silent, overlay, inspected)).toEqual([
    "port 6443 address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("the API address is the first declared port's host address, so every loopback binding names one address", () => {
  const two: K3dCluster = {
    ...overlay,
    ports: [
      { hostAddress: "127.0.0.2", hostPort: 9000, loadBalancerPort: 30000 },
      { hostAddress: "127.0.0.1", hostPort: 8443, loadBalancerPort: 443 },
    ],
  };
  const api = entry({
    "30000/tcp": [{ HostIp: "127.0.0.2", HostPort: "9000" }],
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
    "6443/tcp": [{ HostIp: "127.0.0.1", HostPort: "51234" }],
  });
  expect(drift(api, two)).toEqual([
    "port 6443 address: 127.0.0.1 != 127.0.0.2",
  ]);
});

test("the unreadable message names the port and both commands that failed to report it, and never says to recreate the cluster", () => {
  expect(
    unreadableMessage("kore-local", "k3d-kore-local-serverlb", overlay.ports),
  ).toBe(
    "k3d cluster kore-local does not report the host address of port 443 in `k3d cluster list --output json` or `docker inspect k3d-kore-local-serverlb`; it cannot be checked against the overlay, and recreating the cluster does not change that. Check that k3d and Docker report the load balancer's port bindings.",
  );
});
