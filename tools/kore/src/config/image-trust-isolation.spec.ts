import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "./config.js";
import { trustedSigners } from "./image-trust.js";
import type { Repository } from "./types.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
type Trust = Record<string, unknown>;

async function withTrust(
  environment: string,
  trust: Trust,
): Promise<Repository> {
  const base = await loadRepository(environment);
  return { ...base, imageTrustValues: { ...base.imageTrustValues, trust } };
}

test("local trusts only its own signing key", async () => {
  assert.deepEqual(trustedSigners(await loadRepository("local")), [
    "local-kore-key",
  ]);
});

test("a managed environment trusts exactly its release identities, never the local key", async () => {
  const repository = await loadRepository("managed-example");
  const trust = repository.imageTrustValues?.["trust"] as Trust;
  const signers = trustedSigners(repository);
  assert.deepEqual(signers, trust["subjects"]);
  assert.ok(!signers.includes("local-kore-key"));
});

test("a managed environment cannot adopt a key authority, so a local key is never trusted there", async () => {
  const repository = await withTrust("managed-example", {
    type: "key",
    mode: "warn",
    keyRef: { name: "kore-local-signing-pub", namespace: "cosign-system" },
  });
  await assert.rejects(
    validateRepository(repository),
    /managed environment.*keyless.*local/is,
  );
});

test("an environment without a trust authority trusts no signer", async () => {
  const base = await loadRepository("local");
  const repository: Repository = { ...base, imageTrustValues: undefined };
  assert.deepEqual(trustedSigners(repository), []);
});
