import { expect, test } from "vitest";
import type { K3dCluster } from "../config/index.js";
import {
  drift,
  unmappedMessage,
  unreadableMessage,
  unreadablePorts,
} from "./k3d-drift.js";

const overlay: K3dCluster = {
  clusterName: "kore-local",
  serviceCidr: "10.96.0.0/12",
  ports: [{ hostAddress: "127.0.0.1", hostPort: 443, loadBalancerPort: 443 }],
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
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
  });
  expect(drift(matching, overlay)).toEqual([]);
});

test("a port published on the overlay's host port at another address names the address", () => {
  const wide = entry({ "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "443" }] });
  expect(drift(wide, overlay)).toEqual([
    "port 443 address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("a listed binding that omits its host address is unreadable from the listing, and docker inspect supplies the address that is then compared", () => {
  const silent = entry({ "443/tcp": [{ HostPort: "443" }] });
  expect(unreadablePorts(silent, overlay)).toEqual(overlay.ports);
  const inspected = { "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }] };
  expect(unreadablePorts(silent, overlay, inspected)).toEqual([]);
  expect(drift(silent, overlay, inspected)).toEqual([]);
  const wideInspected = {
    "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "443" }],
  };
  expect(drift(silent, overlay, wideInspected)).toEqual([
    "port 443 address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("a listing that reports the host address is readable without docker inspect", () => {
  const listed = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
  });
  expect(unreadablePorts(listed, overlay)).toEqual([]);
});

/** The local overlay's entry point: the platform-dns 443 mapping to the shared node port (ADR 0132, ADR 0176). */
const entryPoint: K3dCluster = {
  ...overlay,
  ports: [{ hostAddress: "127.0.0.1", hostPort: 443, loadBalancerPort: 30443 }],
};

test("a cluster that still publishes the removed 8443 mapping and no 443 is refused, naming the host port the overlay expects (ADR 0176)", () => {
  const removed = entry({
    "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
  });
  expect(drift(removed, entryPoint)).toEqual(["port 30443: 8443 != 443"]);
});

test("a cluster that publishes 443 and also a leftover 8443 on the loopback address is no difference", () => {
  const both = entry({
    "30443/tcp": [
      { HostIp: "127.0.0.1", HostPort: "443" },
      { HostIp: "127.0.0.1", HostPort: "8443" },
    ],
  });
  expect(drift(both, entryPoint)).toEqual([]);
});

test("a port on another host port is named by its port, not by its address", () => {
  const moved = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "9443" }],
  });
  expect(drift(moved, overlay)).toEqual(["port 443: 9443 != 443"]);
});

test("a container port with no bindings is named unmapped", () => {
  expect(drift(entry({ "443/tcp": [] }), overlay)).toEqual([
    "port 443: unmapped != 443",
  ]);
});

test("without reported mappings only the counts compare, so a missing mapping list is no port difference", () => {
  expect(drift(entry(undefined, { serversCount: 3 }), overlay)).toEqual([
    "servers: 3 != 1",
  ]);
});

test("a listing that reports no load balancer mappings is compared on docker inspect's bindings, so a missing 443 mapping is a difference", () => {
  const preCutover = {
    "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
  };
  expect(drift(entry(undefined), entryPoint, preCutover)).toEqual([
    "port 30443: 8443 != 443",
  ]);
});

test("a listing with no load balancer mappings and docker inspect's bindings that match the overlay is no difference", () => {
  const matching = { "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }] };
  expect(drift(entry(undefined), entryPoint, matching)).toEqual([]);
});

test("a difference on a feature-flagged port names the flag that publishes it", () => {
  const flagged: K3dCluster = {
    ...overlay,
    ports: [
      {
        hostAddress: "127.0.0.1",
        hostPort: 443,
        loadBalancerPort: 30443,
        featureFlag: "platform-dns",
      },
    ],
  };
  const preCutover = {
    "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
  };
  expect(drift(entry(undefined), flagged, preCutover, true)).toEqual([
    "port 30443 (platform-dns): 8443 != 443",
  ]);
});

test("a difference on a feature-flagged port names no flag while the drift-listing-mappings flag is off", () => {
  const flagged: K3dCluster = {
    ...overlay,
    ports: [
      {
        hostAddress: "127.0.0.1",
        hostPort: 443,
        loadBalancerPort: 30443,
        featureFlag: "platform-dns",
      },
    ],
  };
  const preCutover = {
    "30443/tcp": [{ HostIp: "127.0.0.1", HostPort: "8443" }],
  };
  expect(drift(entry(undefined), flagged, preCutover, false)).toEqual([
    "port 30443: 8443 != 443",
  ]);
});

test("the unmapped message names the gap, the container, and never says to recreate the cluster", () => {
  const message = unmappedMessage("kore-local", "k3d-kore-local-serverlb");
  expect(message).toContain(
    "does not report its load balancer's port mappings",
  );
  expect(message).toContain("`docker inspect k3d-kore-local-serverlb`");
  expect(message).toContain("recreating the cluster does not change that");
});

test("an extra mapping that is not the API port is ignored, even when it is off loopback", () => {
  const extra = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
    "9090/tcp": [{ HostIp: "0.0.0.0", HostPort: "51234" }],
  });
  expect(drift(extra, overlay)).toEqual([]);
});

test("the API port's random host port is not compared, but its address is: on the overlay's address it is no difference", () => {
  const api = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
    "6443/tcp": [{ HostIp: "127.0.0.1", HostPort: "51234" }],
  });
  expect(drift(api, overlay)).toEqual([]);
});

test("an API port published on every interface is refused naming its address, whatever host port k3d chose", () => {
  const wide = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
    "6443/tcp": [{ HostIp: "0.0.0.0", HostPort: "59290" }],
  });
  expect(drift(wide, overlay)).toEqual([
    "port 6443 address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("an API port whose address the listing omits is unreadable until docker inspect supplies it, and then compared", () => {
  const silent = entry({
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
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
      { hostAddress: "127.0.0.1", hostPort: 443, loadBalancerPort: 443 },
    ],
  };
  const api = entry({
    "30000/tcp": [{ HostIp: "127.0.0.2", HostPort: "9000" }],
    "443/tcp": [{ HostIp: "127.0.0.1", HostPort: "443" }],
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

const dnsOverlay: K3dCluster = {
  clusterName: "kore-local",
  serviceCidr: "10.96.0.0/12",
  ports: [
    { hostAddress: "127.0.0.1", hostPort: 1053, loadBalancerPort: 1053 },
    {
      hostAddress: "127.0.0.1",
      hostPort: 1053,
      loadBalancerPort: 1053,
      protocol: "udp",
    },
  ],
};

test("a TCP and a UDP mapping on one port are each found under their own protocol", () => {
  const both = entry({
    "1053/tcp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
    "1053/udp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
  });
  expect(drift(both, dnsOverlay)).toEqual([]);
});

test("a UDP mapping published only as TCP is unmapped, not satisfied by the TCP binding", () => {
  const tcpOnly = entry({
    "1053/tcp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
  });
  expect(drift(tcpOnly, dnsOverlay)).toEqual([
    "port 1053/udp: unmapped != 1053",
  ]);
});

test("a UDP binding does not satisfy a mapping with no protocol, and its address is checked on its own protocol", () => {
  const udpOnly = entry({
    "1053/udp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
  });
  expect(drift(udpOnly, dnsOverlay)).toEqual(["port 1053: unmapped != 1053"]);
  const wideUdp = entry({
    "1053/tcp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
    "1053/udp": [{ HostIp: "0.0.0.0", HostPort: "1053" }],
  });
  expect(drift(wideUdp, dnsOverlay)).toEqual([
    "port 1053/udp address: 0.0.0.0 != 127.0.0.1",
  ]);
});

test("an unreadable address is attributed to the protocol that lacks it", () => {
  const silentUdp = entry({
    "1053/tcp": [{ HostIp: "127.0.0.1", HostPort: "1053" }],
    "1053/udp": [{ HostPort: "1053" }],
  });
  expect(unreadablePorts(silentUdp, dnsOverlay)).toEqual([dnsOverlay.ports[1]]);
  expect(
    unreadableMessage("kore-local", "k3d-kore-local-serverlb", [
      dnsOverlay.ports[1]!,
    ]),
  ).toContain("port 1053/udp");
});
