import { beforeEach, expect, test, vi } from "vitest";
import type { Runner, RunResult } from "../runtime/index.js";
import { goldenPathReach } from "./golden-path-reach.js";

const run = vi.fn<Runner["run"]>();
const runner = { run } satisfies Runner;
const options = {
  kubeContext: "k3d-kore-local",
  namespace: "golden-path-example--local",
  service: "golden-path-example",
};

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
    address: "10.0.0.5",
    port: 443,
  });
});

test("uses a published hostname when the Service publishes one instead of an IP", async () => {
  run.mockResolvedValue(
    answer({ loadBalancer: { ingress: [{ hostname: "lb.kore.internal" }] } }),
  );

  expect(await goldenPathReach(runner, options)).toStrictEqual({
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
