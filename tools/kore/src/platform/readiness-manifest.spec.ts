import { expect, test } from "vitest";
import { loadRepository } from "../config/index.js";
import { readyRows } from "./readiness-fixtures.js";
import { platformGeneration } from "./admission-gate.js";
import {
  evaluateReadiness,
  readinessEvidenceName,
  readinessEvidenceObject,
  readinessFailureSummary,
} from "./readiness-manifest.js";
import type { ComponentStatus } from "./status.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md

const when = new Date("2026-11-08T12:00:00.000Z");

test("evidence is open and names every requirement and prerequisite when all are ready", async () => {
  const repository = await loadRepository("local");
  const evidence = evaluateReadiness(repository, readyRows(repository), when);

  expect(evidence.state).toBe("open");
  expect(evidence.failures).toEqual([]);
  expect(evidence.generation).toBe(platformGeneration(repository));
  expect(evidence.manifestVersion).toBe(1);
  expect(evidence.environment).toBe("local");
  expect(evidence.evaluatedAt).toBe(when.toISOString());
  expect(evidence.requirements.map(({ name }) => name)).toEqual(
    repository.readiness.requirements.map(({ name }) => name),
  );
  const prerequisites = evidence.requirements.flatMap(({ checks }) =>
    checks.map(({ name }) => name),
  );
  for (const component of repository.catalog.components) {
    expect(prerequisites).toContain(component.name);
  }
  expect(prerequisites).toContain("registry-trust");
});

test("a degraded component closes the evidence and is named with its requirement and detail", async () => {
  const repository = await loadRepository("local");
  const rows = readyRows(repository).map((row) =>
    row.name === "gatekeeper"
      ? { ...row, status: "degraded" as const, detail: "webhook not ready" }
      : row,
  );
  const evidence = evaluateReadiness(repository, rows, when);

  expect(evidence.state).toBe("closed");
  expect(evidence.failures).toEqual([
    {
      requirement: "policy-engine",
      name: "gatekeeper",
      status: "degraded",
      detail: "webhook not ready",
    },
  ]);
  expect(readinessFailureSummary(evidence)).toBe(
    "policy-engine: gatekeeper (webhook not ready)",
  );
});

test("a prerequisite with no status row counts as missing, never as ready", async () => {
  const repository = await loadRepository("local");
  const rows = readyRows(repository).filter(
    ({ name }) => name !== "registry-trust" && name !== "oci-registry",
  );
  const evidence = evaluateReadiness(repository, rows, when);

  expect(evidence.state).toBe("closed");
  expect(evidence.failures.map(({ name, status }) => [name, status])).toEqual([
    ["oci-registry", "missing"],
    ["registry-trust", "missing"],
  ]);
});

test("the gate row never counts as a prerequisite of itself", async () => {
  const repository = await loadRepository("local");
  const rows: ComponentStatus[] = [
    ...readyRows(repository),
    {
      name: "application-admission-gate",
      namespace: "cluster",
      status: "degraded",
      detail: "closed",
    },
  ];
  expect(evaluateReadiness(repository, rows, when).state).toBe("open");
});

test("the evidence object is a platform-owned ConfigMap in kore-system holding the evidence as JSON", async () => {
  const repository = await loadRepository("local");
  const evidence = evaluateReadiness(repository, readyRows(repository), when);
  const object = readinessEvidenceObject(evidence);

  expect(object.kind).toBe("ConfigMap");
  expect(object.metadata).toMatchObject({
    name: readinessEvidenceName,
    namespace: "kore-system",
  });
  expect(object.metadata.labels["platform.kore.dev/generation"]).toBe(
    evidence.generation,
  );
  expect(JSON.parse(object.data["evidence.json"])).toEqual(evidence);
});
