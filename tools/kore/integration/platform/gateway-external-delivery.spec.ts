import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository, type Repository } from "../../src/config/index.js";
import { composeChartDelivery } from "../../src/platform/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (the handover values)
// Docs: docs/decisions/0160-vps-has-an-internal-gateway-on-the-tailnet-and-an-external-gateway-on-public-443.md
// Issue 1633: the Argo CD-delivered kore-platform-config takes the same external Gateway flag and node port as the Helm path.

/** The releases the delivery hands over, each with a lock entry at its own digest. */
const handedOver = [
  "opa-authorizer",
  "kore-postgresql-api",
  "kore-policy-templates",
  "kore-policy-constraints",
  "kore-local-tls",
  "kore-platform-config",
];

const entries = Object.fromEntries(
  handedOver.map((name, index) => [
    name,
    {
      chart: `ghcr.io/corekraft/kore/charts/${name}`,
      version: "0.0.0-0123456789ab",
      digest: `sha256:${(index + 1).toString(16).repeat(64)}`,
      signer:
        "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.0.0",
    },
  ]),
);

/** vps with the delivery on and the external Gateway set as given. */
async function deliveredVps(externalGateway: boolean): Promise<Repository> {
  const base = await loadRepository("vps");
  return {
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        "platform-argocd-delivery": true,
        "platform-shared-gateway": true,
        "service-listener-sets": true,
        "external-gateway": externalGateway,
      },
    },
  };
}

/** The composed delivery of a repository, with its lock file written to a temporary directory. */
async function composed(repository: Repository) {
  const dir = await mkdtemp(join(tmpdir(), "kore-lock-"));
  const lockPath = join(dir, "platform-charts.lock.json");
  await writeFile(lockPath, JSON.stringify({ version: 1, entries }));
  return composeChartDelivery(repository, lockPath);
}

/** The value of a flag in the features object the delivery hands kore-platform-config last, or undefined when none is there. */
function deliveredFlag(texts: readonly string[], flag: string): unknown {
  const parsed: unknown = JSON.parse(texts[texts.length - 1] ?? "null");
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("features" in parsed)
  ) {
    return undefined;
  }
  const { features } = parsed;
  if (typeof features !== "object" || features === null) {
    return undefined;
  }
  return Reflect.get(features, flag);
}

test("the delivered kore-platform-config takes the external-gateway flag and the overlay's external node port, as the Helm path does", async () => {
  const delivery = await composed(await deliveredVps(true));
  const texts = delivery.chartDelivery?.releaseValues?.["kore-platform-config"];

  assert.ok(texts, "kore-platform-config is handed its values");
  assert.match(texts.join("\n"), /nodePort: 30080/);
  assert.equal(deliveredFlag(texts, "external-gateway"), true);
  assert.equal(deliveredFlag(texts, "service-listener-sets"), true);
});

test("with the external-gateway flag off the delivered values carry it off, so the delivered render adds no external Gateway", async () => {
  const delivery = await composed(await deliveredVps(false));
  const texts =
    delivery.chartDelivery?.releaseValues?.["kore-platform-config"] ?? [];
  assert.equal(deliveredFlag(texts, "external-gateway"), false);
});
