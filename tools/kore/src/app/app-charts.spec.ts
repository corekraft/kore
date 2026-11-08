import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRepository } from "../config/index.js";

test("reference resources template evaluates database values with Helm delimiters", async () => {
  const repository = await loadRepository("local");
  const template = await readFile(
    join(
      repository.root,
      "apps/reference/charts/resources/templates/resources.yaml",
    ),
    "utf8",
  );

  expect(template).not.toContain("{ {");
  expect(template).toContain("{{ .Values.database.retentionPolicy | quote }}");
  expect(template).toContain(
    "compatibilityVersion: {{ .Values.database.compatibilityVersion }}",
  );
});

test("reference workload pins the non-root UID for Kubernetes runtime validation", async () => {
  const repository = await loadRepository("local");
  const template = await readFile(
    join(
      repository.root,
      "apps/reference/charts/workload/templates/workloads.yaml",
    ),
    "utf8",
  );

  expect(template).toContain("runAsUser: 1000");
  expect(template).toContain("runAsGroup: 1000");
});
