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
    "platform-sync-window",
    "platform-shared-gateway",
    "service-listener-sets",
    "external-gateway",
    "external-gateway-limits",
    "external-dns",
    "acme-dns01",
    "platform-hostname-ownership",
    "platform-portal",
    "portal-staged-install",
    "drift-listing-mappings",
    "golden-path-signin",
    "golden-path-template-admission",
    "golden-path-signin-after-portal",
    "postgresql-service-class-instances",
    "gateway-proxy-defaults",
    "data-path-guaranteed-qos",
    "golden-path-safety-defaults",
    "golden-path-service-identity",
    "app-delivery",
    "workload-defaults-admission",
    "pvc-ownership-admission",
    "release-recovery-argocd-refusal",
    "host-published-ports",
    "openbao",
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
  assert.deepEqual(requiredFlags(flags, "external-gateway-limits"), [
    "external-gateway",
  ]);
  assert.deepEqual(requiredFlags(flags, "external-dns"), ["external-gateway"]);
  assert.deepEqual(requiredFlags(flags, "autoscaling-defaults"), []);
});

test("in-cluster-ca is refused in the local overlay through the manifest, because its entry applies to vps and managed-example only", async () => {
  const message = await rejectionOf(
    await withFeatures("local", {
      ...(await loadRepository("local")).environment.features,
      "in-cluster-ca": true,
    }),
  );
  // The old k3d refusal still reports alongside the manifest's until the contract step deletes it.
  assert.ok(
    message.includes(
      "flag in-cluster-ca is in the local overlay but its entry applies to vps, managed-example only; add local to its applies or remove it from the local overlay (ADR 0148)",
    ),
    message,
  );
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
      'environment vps turns on otlp-route, which needs platform-shared-gateway: its route is served only through the shared Gateway; set "platform-shared-gateway": true in the vps environment overlay, or turn otlp-route off',
      "flag otlp-route is on in the vps overlay but infra/catalog/flags.yaml marks it not applicable to vps (pods send OTLP to the in-cluster collector, and no route goes on a Gateway reachable without OTLP authentication (ADR 0174, ADR 0140).); keep it off there (ADR 0148)",
    ].join("\n"),
  );
});
