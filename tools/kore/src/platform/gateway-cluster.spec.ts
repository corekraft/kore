import { expect, test } from "vitest";
import { gatewayEntryPort } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { Cluster, httpsGet } from "./gateway-cluster.live.js";
import type { ProofOptions } from "./gateway-proof.js";
import { fakeRepository, fakeRunner } from "./platform-support.js";

// The host dials the Gateway on the load balancer's entry port (ADR 0176); the
// in-cluster listener, gateway.port, is no host port once the 8443 mapping is gone.
const gateway = { namespace: "kore-system", name: "kore-gateway", port: 8443 };
const options: ProofOptions = {
  namespace: "gateway-proof",
  hostname: "platform.kore.internal",
  gateway,
  image: "registry.kore.internal/echo@sha256:0",
  pullPolicy: "IfNotPresent",
  storeName: "kore-local-store",
  source: { key: "source", property: "value" },
  target: { secret: "target", key: "value" },
};

function clusterWith(runner: Runner): Cluster {
  return new Cluster(fakeRepository({ gateway }), runner);
}

test("httpsGet dials the host entry port, not the in-cluster listener port", async () => {
  const { runner, run } = fakeRunner(() => "ok\n200");
  const got = await httpsGet(clusterWith(runner), options, "/root", "/livez");
  expect(got).toEqual({ status: 200, body: "ok" });
  expect(run).toHaveBeenCalledWith(
    "curl",
    expect.arrayContaining([
      "--resolve",
      "platform.kore.internal:443:127.0.0.1",
      "https://platform.kore.internal:443/livez",
    ]),
    { capture: true },
  );
  expect(run).not.toHaveBeenCalledWith(
    "curl",
    expect.arrayContaining([expect.stringContaining(":8443")]),
    expect.anything(),
  );
});

test("httpsGet reads the entry port from the one platform constant", async () => {
  expect(gatewayEntryPort).toBe(443);
  const { runner } = fakeRunner(() => "\n503");
  await expect(
    httpsGet(clusterWith(runner), options, "/root", "/livez"),
  ).resolves.toEqual({ status: 503, body: "" });
});
