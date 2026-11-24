import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadServiceRegistrations } from "../../src/config/index.js";

// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md
// Issue 1674: the external Gateway's limits are platform-owned. A Service record on disk that carries a limits
// field is refused before anything renders, so an app can neither tune nor raise a limit.

test("a Service registration on disk that carries a limits field is refused, naming the platform-owned rule", async () => {
  const root = await mkdtemp(join(tmpdir(), "kore-service-limits-"));
  await mkdir(join(root, "infra/services"), { recursive: true });
  await writeFile(
    join(root, "infra/services/shop.yaml"),
    JSON.stringify({
      apiVersion: "platform.kore.dev/v1alpha1",
      kind: "Service",
      metadata: { name: "shop" },
      spec: {
        organization: "platform",
        environments: ["vps"],
        limits: { requestsPerSecond: 100000 },
      },
    }),
  );
  await expect(loadServiceRegistrations(root, "vps")).rejects.toThrow(
    "infra/services/shop.yaml: a limits field is platform-owned: the external Gateway's limits are set by the platform in the environment overlay, so a service record cannot tune, lower or raise them (ADR 0160)",
  );
});
