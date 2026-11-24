import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "../../src/config/index.js";

// Docs: docs/decisions/0141-the-vps-host-is-converged-by-an-ansible-playbook-in-the-repository.md

test("the vps host's k3s pin is read from the role's defaults and agrees with the vps overlay, with no cluster", async () => {
  const repository = await loadRepository("vps");
  assert.match(repository.k3sHostPin ?? "", /^v\d+\.\d+\.\d+\+k3s\d+$/);
  assert.deepEqual(await validateRepository(repository), []);
});

test("only the vps overlay carries a k3s host pin, so no other environment compares one", async () => {
  const repository = await loadRepository("local");
  assert.equal(repository.k3sHostPin, undefined);
});

test("validation fails for the vps overlay when its k3s pin is one minor ahead, and names both versions", async () => {
  const repository = await loadRepository("vps");
  const pin = repository.k3sHostPin ?? "";
  const minor = pin.replace(/^v(\d+)\.(\d+)\./, (_, major, minorPart) => {
    return `v${major}.${Number(minorPart) + 1}.`;
  });
  const version = repository.environment.cluster?.kubernetesVersion ?? "";
  await assert.rejects(
    validateRepository({ ...repository, k3sHostPin: minor }),
    (error: Error) => {
      assert.match(error.message, new RegExp(minor.replace(/\+/g, "\\+")));
      assert.match(error.message, new RegExp(version.replace(/\./g, "\\.")));
      assert.match(error.message, /same pull request/);
      return true;
    },
  );
});
