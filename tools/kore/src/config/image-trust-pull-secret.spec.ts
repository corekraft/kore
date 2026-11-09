import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { registryPullSecretName } from "../images/index.js";
import { findRoot, loadRepository, validateRepository } from "./config.js";

const releaseSubject =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.1.1";
const issuer = "https://token.actions.githubusercontent.com";
const keyless = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  type: "keyless",
  mode: "warn",
  issuer,
  subjects: [releaseSubject],
  ...over,
});

const run = promisify(execFile);

async function renderPlatformPolicy(
  environment: string,
  override?: Record<string, unknown>,
): Promise<string> {
  const root = await findRoot();
  const repository = await loadRepository(environment);
  const trust = {
    ...(repository.imageTrustValues?.trust as Record<string, unknown>),
    ...override,
  };
  const { stdout } = await run("helm", [
    "template",
    "kore-image-policy",
    join(root, "infra/charts/image-policy"),
    "--set-string",
    "platform.registry.address=registry.example:5000",
    "--set-json",
    `trust=${JSON.stringify(trust)}`,
  ]);
  return (
    stdout
      .split(/^---$/m)
      .find((d) => d.includes("name: kore-platform-images")) ?? ""
  );
}

test("the local platform policy verifies signatures with the kore read credential from the workload namespace", async () => {
  const policy = await renderPlatformPolicy("local");

  assert.match(
    policy,
    /source:\s*\n\s*- signaturePullSecrets:\s*\n\s*- name: "?kore-registry-read"?/,
  );
  assert.equal(registryPullSecretName, "kore-registry-read");
  assert.doesNotMatch(
    policy,
    /\boci:/,
    "the signature repository is not overridden",
  );
});

test("a keyless authority carries the same signature credential when the environment sets one", async () => {
  const policy = await renderPlatformPolicy("managed-example", {
    signaturePullSecret: "kore-registry-read",
  });

  assert.match(policy, /release-workflow[\s\S]*signaturePullSecrets/);
});

test("an environment that sets no signature credential renders none, so external registries keep the provider's", async () => {
  const policy = await renderPlatformPolicy("managed-example");

  assert.doesNotMatch(policy, /signaturePullSecrets/);
});

test("the upstream static policy never carries a registry credential", async () => {
  const root = await findRoot();
  const repository = await loadRepository("local");
  const { stdout } = await run("helm", [
    "template",
    "kore-image-policy",
    join(root, "infra/charts/image-policy"),
    "--set-string",
    "platform.registry.address=registry.example:5000",
    "--set-json",
    `trust=${JSON.stringify(repository.imageTrustValues?.trust)}`,
  ]);
  const upstream =
    stdout
      .split(/^---$/m)
      .find((d) => d.includes("name: kore-upstream-images")) ?? "";
  assert.doesNotMatch(upstream, /signaturePullSecrets/);
});

test("local trusts its local signing key and managed-example a pinned release workflow", async () => {
  const local = await loadRepository("local");
  assert.deepEqual(local.imageTrustValues?.["trust"], {
    type: "key",
    mode: "enforce",
    signaturePullSecret: "kore-registry-read",
    keyRef: { name: "kore-local-signing-pub", namespace: "cosign-system" },
  });
  const managed = await loadRepository("managed-example");
  assert.deepEqual(
    managed.imageTrustValues?.trust,
    keyless({
      subjects: [
        releaseSubject,
        releaseSubject.replace(/v0\.1\.1$/, "v0.2.0"),
        releaseSubject.replace(/v0\.1\.1$/, "v0.3.1"),
      ],
    }),
  );
  await validateRepository(local);
  await validateRepository(managed);
});
