import assert from "node:assert/strict";
import { test } from "vitest";
import {
  appliedFlags,
  flagEntry,
  loadRepository,
  neverRetires,
  notApplicableReason,
  requiredFlags,
  validateRepository,
} from "../../src/config/index.js";
import type { Repository } from "../../src/config/index.js";

// Docs: docs/decisions/0148-a-flag-manifest-declares-each-flags-kind-environments-and-prerequisites.md

/** The repository of an environment with its overlay's features replaced, as `kore validate` would load it. */
async function withFeatures(
  name: string,
  features: Record<string, boolean>,
): Promise<Repository> {
  const base = await loadRepository(name);
  return {
    ...base,
    environment: { ...base.environment, features: { ...features } },
  };
}

async function rejectionOf(repository: Repository): Promise<string> {
  try {
    await validateRepository(repository);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

test("the real flag manifest validates every overlay it covers, local, vps and managed-example, without a validation error", async () => {
  for (const name of ["local", "vps", "managed-example"]) {
    // validateRepository throws on any error; a warning never fails it.
    await validateRepository(await loadRepository(name));
  }
});

test("an overlay flag with no manifest entry fails validation, naming the flag and the file to add it to", async () => {
  const base = await loadRepository("vps");
  const message = await rejectionOf({
    ...base,
    environment: {
      ...base.environment,
      features: {
        ...base.environment.features,
        "unlisted-fixture-flag": false,
      },
    },
  });
  assert.equal(
    message,
    "flag unlisted-fixture-flag is in the vps overlay but has no entry in infra/catalog/flags.yaml; add an entry with its kind and the environments it applies to (ADR 0148)",
  );
});

test("a harness flag in the vps overlay fails validation, because the manifest applies harness flags to local only", async () => {
  const base = await loadRepository("vps");
  const message = await rejectionOf({
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, "tick-self-update": false },
    },
  });
  assert.equal(
    message,
    "flag tick-self-update is in the vps overlay but its entry applies to local only; add vps to its applies or remove it from the vps overlay (ADR 0148)",
  );
});

test("the real vps overlay lists no harness flag, and every flag it lists applies to vps", async () => {
  const { environment, flags } = await loadRepository("vps");
  for (const name of Object.keys(environment.features ?? {})) {
    const entry = flagEntry(flags, name);
    assert.notEqual(entry?.kind, "harness", name);
    assert.ok(entry?.applies.includes("vps"), name);
  }
});

test("the flags that apply to vps are the ones the manifest declares, pending flags excluded", async () => {
  const { flags } = await loadRepository("vps");
  assert.deepEqual(appliedFlags(flags, "vps"), [
    "agentgateway-mesh-enrollment",
    "autoscaling-defaults",
    "gateway-class-change-release",
    "gateway-rollback-order",
    "ingress-agentgateway",
    "agentgateway-data-plane-metrics",
    "platform-organization-service-apis",
    "platform-argocd-delivery",
    "suborg-tenancy",
    "suborg-network-policy",
    "suborg-delivery-project",
    "platform-sync-window",
    "platform-shared-gateway",
    "service-listener-sets",
    "external-gateway",
    "external-gateway-limits",
    "external-dns",
    "acme-dns01",
    "domain-expiry-alert",
    "acme-issuers",
    "platform-hostname-ownership",
    "platform-portal",
    "portal-staged-install",
    "drift-listing-mappings",
    "golden-path-signin",
    "golden-path-template-admission",
    "golden-path-signin-after-portal",
    "postgresql-service-class-instances",
    "database-role-split",
    "gateway-proxy-defaults",
    "data-path-guaranteed-qos",
    "data-path-priority-class",
    "golden-path-safety-defaults",
    "golden-path-service-identity",
    "app-delivery",
    "app-sizing",
    "workload-defaults-admission",
    "pvc-ownership-admission",
    "release-recovery-argocd-refusal",
    "host-published-ports",
    "openbao",
    "database-backups",
    "openbao-snapshots",
    "registry-revert-keep",
    "platform-dns",
    "in-cluster-ca",
    "k3s-registry-trust",
    "registry-tailnet-forward",
  ]);
});

test("an environment flag marked never-retire is reported as never retiring, and a feature flag is not", async () => {
  const { flags } = await loadRepository("local");
  for (const name of [
    "in-cluster-ca",
    "k3s-registry-trust",
    "registry-tailnet-forward",
    "local-image-reuse",
  ]) {
    assert.equal(neverRetires(flags, name), true, name);
  }
  assert.equal(neverRetires(flags, "autoscaling-defaults"), false);
});

test("the real manifest declares each prerequisite the overlay check enforces, so the requirement is stated once in the manifest and the old check agrees with it", async () => {
  const { flags } = await loadRepository("local");
  assert.deepEqual(requiredFlags(flags, "registry-by-name"), [
    "platform-shared-gateway",
  ]);
  assert.deepEqual(requiredFlags(flags, "otlp-route"), [
    "platform-shared-gateway",
  ]);
  assert.deepEqual(requiredFlags(flags, "service-listener-sets"), [
    "platform-shared-gateway",
  ]);
  assert.deepEqual(requiredFlags(flags, "external-gateway"), [
    "service-listener-sets",
  ]);
  assert.deepEqual(requiredFlags(flags, "acme-issuers"), ["acme-dns01"]);
  assert.deepEqual(requiredFlags(flags, "external-gateway-limits"), [
    "external-gateway",
  ]);
  assert.deepEqual(requiredFlags(flags, "external-dns"), ["external-gateway"]);
  assert.deepEqual(requiredFlags(flags, "autoscaling-defaults"), []);
});

test("in-cluster-ca is refused in the local overlay by the manifest and by the provider check, each in its own words", async () => {
  const message = await rejectionOf(
    await withFeatures("local", {
      ...(await loadRepository("local")).environment.features,
      "in-cluster-ca": true,
    }),
  );
  assert.ok(
    message.includes(
      "flag in-cluster-ca is in the local overlay but its entry applies to vps, managed-example only; add local to its applies or remove it from the local overlay (ADR 0148)",
    ),
    message,
  );
  assert.ok(
    message.includes(
      "environment local turns on in-cluster-ca, which creates the cluster's own root CA, but a k3d environment's CA comes from kore trust install and the two would own one ClusterIssuer; turn in-cluster-ca off in the local environment overlay",
    ),
    message,
  );
});

test("each prerequisite edge is refused by validation when the flag is on and its required flag is off, naming both flags", async () => {
  const edges = [
    ["registry-by-name", "platform-shared-gateway"],
    ["otlp-route", "platform-shared-gateway"],
    ["service-listener-sets", "platform-shared-gateway"],
    ["external-gateway", "service-listener-sets"],
    ["external-gateway-limits", "external-gateway"],
    ["external-dns", "external-gateway"],
  ] as const;
  const { environment } = await loadRepository("local");
  const allOff = Object.fromEntries(
    Object.keys(environment.features ?? {}).map((name) => [name, false]),
  );
  for (const [flag, needed] of edges) {
    const message = await rejectionOf(
      await withFeatures("local", { ...allOff, [flag]: true }),
    );
    assert.ok(
      message.includes(
        `flag ${flag} is on in the local overlay but requires ${needed}, which is off there; set "${needed}": true in the local overlay, or turn ${flag} off (ADR 0148)`,
      ),
      `${flag} needs ${needed}: ${message}`,
    );
  }
});

// Issue 1637: external-gateway keeps the environments it applies to, and its requires holds service-listener-sets only.
// Its prerequisite acme-issuers applies to vps alone, and a requires edge cannot yet bind only where the required flag
// applies (ADR 0148), so vps refuses the pair in the environment check instead (acme-issuers.ts, ADR 0157).
test("external-gateway applies to local, vps and managed-example, and every one of those overlays lists it false", async () => {
  const { flags } = await loadRepository("vps");
  assert.deepEqual(flagEntry(flags, "external-gateway")?.applies, [
    "local",
    "vps",
    "managed-example",
  ]);
  for (const name of ["local", "vps", "managed-example"]) {
    const repository = await loadRepository(name);
    assert.equal(
      repository.environment.features?.["external-gateway"],
      false,
      name,
    );
  }
});

test("a fixture overlay that turns a flag on still validates, so activating a flag does not break the vps overlay", async () => {
  const repository = await withFeatures("vps", {
    ...(await loadRepository("vps")).environment.features,
    "autoscaling-defaults": true,
  });
  assert.deepEqual(await validateRepository(repository), []);
});

test("database-routes, otlp-route and registry-by-name are not applicable to vps, each reporting its one-line reason from the manifest, and platform-dns applies to vps", async () => {
  const { flags } = await loadRepository("vps");
  assert.equal(
    notApplicableReason(flags, "database-routes", "vps"),
    "v1 keeps the 5432 passthrough off the vps Gateways; databases stay internal (ADR 0160).",
  );
  assert.equal(
    notApplicableReason(flags, "otlp-route", "vps"),
    "pods send OTLP to the in-cluster collector, and no route goes on a Gateway reachable without OTLP authentication (ADR 0174, ADR 0140).",
  );
  assert.equal(
    notApplicableReason(flags, "registry-by-name", "vps"),
    "vps serves the registry as an in-cluster ClusterIP, not by name (ADR 0143).",
  );
  assert.equal(notApplicableReason(flags, "platform-dns", "vps"), undefined);
  assert.ok(appliedFlags(flags, "vps").includes("platform-dns"));
});

test("a fixture that turns one of the not-applicable flags on for vps fails validation, naming the manifest and the reason", async () => {
  const base = await loadRepository("vps");
  const message = await rejectionOf({
    ...base,
    environment: {
      ...base.environment,
      features: { ...base.environment.features, "otlp-route": true },
    },
  });
  assert.equal(
    message,
    [
      "flag otlp-route is on in the vps overlay but infra/catalog/flags.yaml marks it not applicable to vps (pods send OTLP to the in-cluster collector, and no route goes on a Gateway reachable without OTLP authentication (ADR 0174, ADR 0140).); keep it off there (ADR 0148)",
      'flag otlp-route is on in the vps overlay but requires platform-shared-gateway, which is off there; set "platform-shared-gateway": true in the vps overlay, or turn otlp-route off (ADR 0148)',
    ].join("\n"),
  );
});
