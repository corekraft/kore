import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

// The k3d load balancer publishes the Gateway port, so `kore tunnel` refuses a
// k3d overlay. The live README quick start must stop a tunnel only where one
// exists (found live: its cleanup threw on k3d).

test("the live README quick start stops the tunnel only for a Minikube overlay", async () => {
  const source = await readFile(
    new URL("./platform.integration.spec.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /provider === "minikube"[\s\S]{0,80}stopLocalTunnel\(repository, runner\)/,
  );
});
