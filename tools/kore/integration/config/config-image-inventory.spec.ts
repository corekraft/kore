import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository, validateRepository } from "../../src/config/config.js";

// Docs: docs/decisions/0056-platform-image-inventory.md

test("an unknown image inventory mode is rejected before any cluster is touched", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: { ...base.environment, imageInventory: "warn" as never },
    }),
    /environment\.imageInventory must be audit or enforce/,
  );
});

test("local audits and managed-example enforces the image inventory", async () => {
  assert.equal(
    (await loadRepository("local")).environment.imageInventory,
    "audit",
  );
  assert.equal(
    (await loadRepository("managed-example")).environment.imageInventory,
    "enforce",
  );
});

test("only cosign-system and kore-registry are exempt from enrollment, in every environment", async () => {
  for (const name of ["local", "managed-example"]) {
    const { environment } = await loadRepository(name);
    assert.deepEqual(
      Object.keys(environment.enrollmentExemptions ?? {}).sort(),
      ["cosign-system", "kore-registry"],
    );
  }
});

test("an enrollment exemption for a namespace the catalog does not manage is rejected", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: {
        ...base.environment,
        enrollmentExemptions: {
          ...base.environment.enrollmentExemptions,
          "kube-system": "widened",
        },
      },
    }),
    /enrollmentExemptions: kube-system is not a platform namespace/,
  );
});

test("an enrollment exemption must carry a reason", async () => {
  const base = await loadRepository("local");

  await assert.rejects(
    validateRepository({
      ...base,
      environment: {
        ...base.environment,
        enrollmentExemptions: { "cosign-system": " " },
      },
    }),
    /enrollmentExemptions: cosign-system needs a reason/,
  );
});
