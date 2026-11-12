import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot, loadRepository } from "./config.js";

test("repository toolchain pins are declared in the local mise profile", async () => {
  const root = await findRoot();
  const mise = await readFile(join(root, ".mise.toml"), "utf8");
  for (const pin of [
    'node = "26.13.0"',
    'npm = "12.2.2"',
    'k3d = "5.9.0"',
    'kubectl = "1.37.2"',
    'helm = "4.3.1"',
    'yq = "4.54.2"',
    'sops = "3.13.3"',
    'age = "1.3.2"',
    'mkcert = "1.4.4"',
    'opa = "1.22.2"',
    'tofu = "1.13.9"',
    'cosign = "3.1.4"',
    'crane = "0.22.1"',
    'promtool = "3.16.0"',
  ]) {
    assert.match(mise, new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("the repository tool catalog pins Cosign for image verification", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.tools.cosign, "3.1.4");
});

test("the tool catalog pins k3d and the k3s image matches the local Kubernetes version", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.tools.k3d, "5.9.0");
  assert.equal(
    repository.versions.images.k3s?.split("@")[0],
    `rancher/k3s:v${repository.versions.kubernetes}-k3s1`,
  );
});

test("the repository tool catalog pins crane for mirroring by digest", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.tools.crane, "0.22.1");
});

test("local catalog pins an available Istio chart release", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.components.istio, "1.31.4");
  assert.equal(repository.versions.components.crossplane, "2.4.3");
  assert.equal(repository.versions.components["external-secrets"], "2.14.0");
  assert.equal(repository.versions.components["cloudnative-pg"], "0.29.1");
  assert.equal(
    repository.versions.components["opentelemetry-operator"],
    "0.129.0",
  );
  assert.equal(repository.versions.components.prometheus, "29.45.1");
  assert.equal(repository.versions.components.loki, "7.5.0");
  assert.equal(
    repository.versions.components["opentelemetry-collector"],
    "0.178.2",
  );
});

test("Istio charts avoid the Google-hosted repository Istio is retiring", async () => {
  const repository = await loadRepository("local");
  const istio = repository.catalog.components.filter(
    ({ version }) => version === "istio",
  );
  assert.ok(istio.length >= 4);
  for (const component of istio) {
    assert.equal(
      component.repository,
      "https://blob.istio.io/istio-release/charts",
    );
  }
});

test("local tool catalog matches the supported Docker CLI line", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.versions.tools.docker, "29.7.2");
});

test("chart image defaults and the reference base image match the catalog pins", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const registry = await readFile(
    join(root, "infra/charts/oci-registry/values.yaml"),
    "utf8",
  );
  const opaAuthorizer = await readFile(
    join(root, "infra/charts/opa-authorizer/values.yaml"),
    "utf8",
  );
  const dockerfile = await readFile(
    join(root, "apps/reference/Dockerfile"),
    "utf8",
  );
  assert.match(
    repository.versions.images["oci-registry"] ?? "",
    /^registry:3\.1\.2@sha256:/,
  );
  assert.match(registry, /tag: 3\.1\.2\b/);
  const opaEnvoy = repository.approved.images.find(
    ({ name }) => name === "opa-envoy",
  );
  assert.match(
    opaEnvoy?.image ?? "",
    /^docker\.io\/openpolicyagent\/opa:1\.22\.2-envoy@sha256:/,
  );
  assert.match(opaAuthorizer, /tag: 1\.22\.2-envoy\b/);
  assert.ok(
    opaAuthorizer.includes(opaEnvoy!.image.split("@")[1]!),
    "the chart pins the approved opa-envoy digest",
  );
  assert.match(dockerfile, /^FROM node:26\.13\.0-alpine3\.24$/m);
});

test("the catalog declares Sigstore Policy Controller as a bootstrap component with readiness and CRD ownership, enforcing nothing", async () => {
  const repository = await loadRepository("local");
  const component = repository.catalog.components.find(
    ({ name }) => name === "policy-controller",
  );
  assert.ok(component, "policy-controller is declared");
  assert.equal(component.phase, "bootstrap");
  assert.equal(component.kind, "helm");
  assert.equal(component.repository, "https://sigstore.github.io/helm-charts");
  assert.equal(component.chart, "policy-controller");
  assert.equal(component.version, "policy-controller");
  assert.equal(repository.versions.components["policy-controller"], "0.10.8");
  assert.deepEqual(component.ownsCRDs, [
    "clusterimagepolicies.policy.sigstore.dev",
    "trustroots.policy.sigstore.dev",
  ]);
  assert.deepEqual(component.readiness, [
    "deployment/policy-controller-webhook",
    "mutatingwebhookconfiguration/defaulting.clusterimagepolicy.sigstore.dev",
    "mutatingwebhookconfiguration/policy.sigstore.dev",
    "validatingwebhookconfiguration/validating.clusterimagepolicy.sigstore.dev",
    "validatingwebhookconfiguration/policy.sigstore.dev",
  ]);
  const root = await findRoot();
  const files = (
    await readdir(join(root, "infra"), { recursive: true })
  ).filter((file) => /\.ya?ml$/.test(file) && !file.startsWith("plans"));
  for (const file of files) {
    const text = await readFile(join(root, "infra", file), "utf8");
    // Only the image-policy chart (ADR 0028) renders policies; its namespaces
    // are never labelled, so nothing is enforced.
    if (!file.startsWith("charts/image-policy/")) {
      assert.doesNotMatch(text, /kind:\s*"?ClusterImagePolicy"?/, file);
    }
    assert.doesNotMatch(text, /policy\.sigstore\.dev\/include/, file);
  }
});
