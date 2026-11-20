import { beforeEach, expect, test, vi } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import { goldenPathReach } from "./golden-path-reach.live.js";

const run = vi.fn<Runner["run"]>();
const runner = { run } satisfies Runner;
const options = {
  kubeContext: "k3d-kore-local",
  namespace: "golden-path-example--local",
  service: "golden-path-example",
  sharedGateway: {
    namespace: "kore-system",
    name: "kore-gateway",
    port: 8443,
  },
};
const ownGateway = {
  namespace: "golden-path-example--local",
  name: "golden-path-example",
};
const sharedGateway = { namespace: "kore-system", name: "kore-gateway" };

function answer(status: unknown, ports: unknown = [{ port: 443 }]): RunResult {
  return {
    stdout: JSON.stringify({
      spec: { type: "LoadBalancer", ports },
      status,
    }),
    stderr: "",
    code: 0,
  };
}

/** What kubectl prints for a named object that is absent under --ignore-not-found. */
function absent(): RunResult {
  return { stdout: "", stderr: "", code: 0 };
}

function routed(): RunResult {
  return {
    stdout: "httproute.gateway.networking.k8s.io/golden-path-example-shared\n",
    stderr: "",
    code: 0,
  };
}

beforeEach(() => {
  run.mockReset();
});

test("reads the Service on its configured context and namespace, never the current one", async () => {
  run.mockResolvedValue(
    answer({ loadBalancer: { ingress: [{ ip: "10.0.0.5" }] } }),
  );

  await goldenPathReach(runner, options);

  expect(run).toHaveBeenCalledExactlyOnceWith(
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "golden-path-example--local",
      "get",
      "service",
      "golden-path-example",
      "--ignore-not-found",
      "--output",
      "json",
    ],
    { capture: true },
  );
});

test("reaches the route at the published address and the Service's own port", async () => {
  run.mockResolvedValue(
    answer({ loadBalancer: { ingress: [{ ip: "10.0.0.5" }] } }),
  );

  expect(await goldenPathReach(runner, options)).toStrictEqual({
    gateway: ownGateway,
    via: "service",
    address: "10.0.0.5",
    port: 443,
  });
});

test("keeps the service's own Gateway when its Service publishes an address, without reading the shared route", async () => {
  run.mockResolvedValue(
    answer({ loadBalancer: { ingress: [{ ip: "10.0.0.5" }] } }),
  );

  await goldenPathReach(runner, options);

  expect(run).toHaveBeenCalledOnce();
});

test("uses a published hostname when the Service publishes one instead of an IP", async () => {
  run.mockResolvedValue(
    answer({ loadBalancer: { ingress: [{ hostname: "lb.kore.internal" }] } }),
  );

  expect(await goldenPathReach(runner, options)).toStrictEqual({
    gateway: ownGateway,
    via: "service",
    address: "lb.kore.internal",
    port: 443,
  });
});

test("refuses by name before any load when the Service has no published address", async () => {
  run.mockResolvedValue(answer({ loadBalancer: {} }));

  await expect(goldenPathReach(runner, options)).rejects.toThrow(
    "the golden-path Service golden-path-example--local/golden-path-example on context k3d-kore-local has no published address (status.loadBalancer.ingress is empty), so the host cannot reach its Gateway; the reference routes at kore.local are unaffected; the shared Gateway attach (#1211) publishes the address",
  );
});

test("refuses when the Service has no status yet, the same way", async () => {
  run.mockResolvedValue(answer(undefined));

  await expect(goldenPathReach(runner, options)).rejects.toThrow(
    "has no published address (status.loadBalancer.ingress is empty)",
  );
});

test("refuses when the Service declares no port to reach", async () => {
  run.mockResolvedValue(
    answer({ loadBalancer: { ingress: [{ ip: "10.0.0.5" }] } }, []),
  );

  await expect(goldenPathReach(runner, options)).rejects.toThrow(
    "golden-path Service golden-path-example--local/golden-path-example on context k3d-kore-local declares no port",
  );
});

test("reaches the shared Gateway through the k3d load balancer when the service has no Gateway of its own", async () => {
  run.mockResolvedValueOnce(absent()).mockResolvedValueOnce(routed());

  expect(await goldenPathReach(runner, options)).toStrictEqual({
    gateway: sharedGateway,
    via: "shared",
    port: 8443,
  });
});

test("checks the service's shared HTTPRoute in its own namespace before using the shared Gateway", async () => {
  run.mockResolvedValueOnce(absent()).mockResolvedValueOnce(routed());

  await goldenPathReach(runner, options);

  expect(run).toHaveBeenNthCalledWith(
    2,
    "kubectl",
    [
      "--context",
      "k3d-kore-local",
      "--namespace",
      "golden-path-example--local",
      "get",
      "httproute",
      "golden-path-example-shared",
      "--ignore-not-found",
      "--output",
      "name",
    ],
    { capture: true },
  );
});

test("refuses by name before any load when the service has neither its own Gateway nor a shared route", async () => {
  run.mockResolvedValueOnce(absent()).mockResolvedValueOnce(absent());

  await expect(goldenPathReach(runner, options)).rejects.toThrow(
    "the golden-path Service golden-path-example--local/golden-path-example on context k3d-kore-local has no Gateway of its own, and its HTTPRoute golden-path-example-shared is absent from golden-path-example--local, so the shared Gateway kore-system/kore-gateway has no route to the host; deliver the service with platform-shared-gateway on (ADR 0134)",
  );
});
