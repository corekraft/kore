import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { degradationTarget } from "./gate-degradation-support.js";
import { readinessEvidenceName } from "./readiness-manifest.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md

test("the degradation target is a single-deployment component the readiness manifest requires", async () => {
  const repository = await loadRepository("local");
  const target = degradationTarget(repository);
  const required = repository.readiness.requirements.flatMap(
    ({ components }) => components ?? [],
  );
  expect(required).toContain(target.component);
  expect(target.deployment).toMatch(/^[a-z0-9-]+$/);
  expect(target.namespace).not.toBe("");
});

test("the degradation target is not the gate's own machinery", async () => {
  const repository = await loadRepository("local");
  const target = degradationTarget(repository);
  // Scaling Gatekeeper, the registry or the evidence writer would stop the
  // proof from observing the gate it closes.
  expect(["gatekeeper", "oci-registry", "policy-controller"]).not.toContain(
    target.component,
  );
  expect(readinessEvidenceName).not.toBe("");
});
