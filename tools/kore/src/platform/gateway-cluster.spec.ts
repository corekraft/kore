import { expect, test, vi } from "vitest";
import { gatewayEntryPort } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { Cluster, httpsGet } from "./gateway-cluster.live.js";
import type { ProofOptions } from "./gateway-proof.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

// The host dials the Gateway on the load balancer's entry port (ADR 0176); the
// in-cluster listener, gateway.port, is no host port once the 8443 mapping is gone.
const gateway = { namespace: "kore-system", name: "kore-gateway", port: 8443 };
const options = { hostname: "platform.kore.internal" } as ProofOptions;

function clusterWith(runner: Runner): Cluster {
  return new Cluster(fakeRepository({ gateway }), runner);
}

test("httpsGet dials the host entry port, not the in-cluster listener port", async () => {
  const { runner, run } = fakeRunner(() => "ok\n200");
  const got = await httpsGet(clusterWith(runner), options, "/root", "/livez");
  expect(got).toEqual({ status: 200, body: "ok" });
  const args = run.mock.calls[0]?.[1] as string[];
  expect(args).toContain("platform.kore.internal:443:127.0.0.1");
  expect(args).toContain("https://platform.kore.internal:443/livez");
  expect(args.join(" ")).not.toContain(":8443");
});

test("httpsGet reads the entry port from the one platform constant", async () => {
  expect(gatewayEntryPort).toBe(443);
  const { runner, run } = fakeRunner(() => "\n503");
  await expect(
    httpsGet(clusterWith(runner), options, "/root", "/livez"),
  ).resolves.toEqual({ status: 503, body: "" });
  expect(vi.mocked(run).mock.calls[0]?.[1]).toContain(
    "https://platform.kore.internal:443/livez",
  );
});
