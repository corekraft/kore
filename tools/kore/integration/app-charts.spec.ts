import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRepository } from "../src/config/index.js";

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

async function referenceTemplate(name: string): Promise<string> {
  const repository = await loadRepository("local");
  return readFile(
    join(repository.root, `apps/reference/charts/workload/templates/${name}`),
    "utf8",
  );
}

test("reference workload injects the database password only through a secretKeyRef", async () => {
  const template = await referenceTemplate("workloads.yaml");

  expect(template).toMatch(
    /name: PGPASSWORD, valueFrom: \{secretKeyRef: \{name: \{\{ \$\.Values\.database\.passwordSecret\.name \}\}, key: \{\{ \$\.Values\.database\.passwordSecret\.key \}\}\}\}/,
  );
  expect(template).toContain(
    "name: PGSSLMODE, valueFrom: {secretKeyRef: {name: reference-db-connection, key: sslmode}}",
  );
  for (const line of template
    .split("\n")
    .filter((l) => l.includes("PGPASSWORD"))) {
    expect(line).not.toMatch(/\bvalue:/);
  }
});

test("reference migrations run as an idempotent pre-install and pre-upgrade hook Job using the app image", async () => {
  const template = await referenceTemplate("migrate.yaml");

  expect(template).toContain("kind: Job");
  expect(template).toContain('"helm.sh/hook": pre-install,pre-upgrade');
  expect(template).toContain("before-hook-creation");
  expect(template).toContain("src/migrate-main.ts");
  expect(template).toContain("PGPASSWORD");
  expect(template).toContain("secretKeyRef");
  expect(template).toContain("restartPolicy: Never");
  expect(template).toContain("activeDeadlineSeconds");
  expect(template).toContain("runAsUser: 1000");
  expect(template).toContain("readOnlyRootFilesystem: true");
  expect(template).toContain(
    "platform.kore.dev/service-account: reference-migrate",
  );
  expect(template).not.toMatch(/PGPASSWORD,\s*value:/);
});

test("reference frontend receives no database environment and no password", async () => {
  const template = await referenceTemplate("workloads.yaml");

  expect(template.match(/PGPASSWORD/g)).toHaveLength(1);
  const passwordAt = template.indexOf("PGPASSWORD");
  const guardAt = template.lastIndexOf(
    '{{- if eq $component "api" }}',
    passwordAt,
  );
  const guardEnd = template.indexOf("{{- end }}", passwordAt);
  expect(guardAt).toBeGreaterThanOrEqual(0);
  expect(guardEnd).toBeGreaterThan(passwordAt);
  expect(template.slice(guardAt, guardEnd)).toContain("PGHOST");
});

test("reference peer authentication is scoped to the app workloads", async () => {
  const template = await referenceTemplate("workloads.yaml");

  expect(template).toMatch(
    /kind: PeerAuthentication\nmetadata: \{name: strict\}\nspec:\n\s+selector: \{matchLabels: \{app\.kubernetes\.io\/part-of: reference\}\}\n\s+mtls: \{mode: STRICT\}/,
  );
});

test("reference migrate hook ServiceAccount is removed after the hook succeeds", async () => {
  const template = await referenceTemplate("migrate.yaml");
  const account = template.split("\n---\n")[0] ?? "";

  expect(account).toContain("kind: ServiceAccount");
  expect(account).toContain("before-hook-creation,hook-succeeded");
});
