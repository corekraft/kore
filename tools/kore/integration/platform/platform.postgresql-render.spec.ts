import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: infra/apis/postgresql/tests/contract.md
// Offline render of the PostgreSQL composition. function-go-templating needs
// the Crossplane function runtime (a container engine), so the Go templates are
// rendered with `helm template`, which uses the same Go template engine and
// Sprig functions, against a synthetic observed composite. No cluster.

const run = promisify(execFile);

interface Composite {
  retentionPolicy?: string;
  compatibilityVersion?: number;
  database?: { phase?: string; phaseReason?: string };
}

async function templates(): Promise<Map<string, string>> {
  const root = await findRoot();
  const source = await readFile(
    join(root, "infra/apis/postgresql/compositions/local.yaml"),
    "utf8",
  );
  const found = new Map<string, string>();
  for (const part of source.split(/^ {4}- step: /m).slice(1)) {
    const step = part.split("\n")[0] ?? "";
    const body = part.split(/^ {10}template: \|\n/m)[1];
    if (body === undefined) {
      continue;
    }
    const lines: string[] = [];
    for (const line of body.split("\n")) {
      if (line !== "" && !line.startsWith(" ".repeat(12))) {
        break;
      }
      lines.push(line.slice(12));
    }
    found.set(step, lines.join("\n"));
  }
  return found;
}

async function render(step: string, composite: Composite): Promise<string> {
  const template = (await templates()).get(step);
  assert.ok(template, `composition has a ${step} step with an inline template`);
  const directory = await mkdtemp(join(tmpdir(), "kore-composition-"));
  try {
    await mkdir(join(directory, "templates"));
    await writeFile(
      join(directory, "Chart.yaml"),
      "apiVersion: v2\nname: composition\nversion: 0.0.0\n",
    );
    await writeFile(
      join(directory, "templates", "step.yaml"),
      `{{- with .Values }}\n${template}\n{{- end }}\n`,
    );
    const observed = {
      composite: {
        resource: {
          metadata: { name: "orders-db", namespace: "orders" },
          spec: {
            retentionPolicy: composite.retentionPolicy ?? "Delete",
            compatibilityVersion: composite.compatibilityVersion ?? 17,
            storageSize: "5Gi",
            connectionSecretName: "orders-db-conn",
          },
        },
      },
      resources: composite.database
        ? { database: { resource: { status: composite.database } } }
        : {},
    };
    const values = join(directory, "values.json");
    await writeFile(values, JSON.stringify({ observed }));
    const { stdout } = await run("helm", [
      "template",
      "composition",
      directory,
      "--values",
      values,
    ]);
    return stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const field = (doc: string, name: string): string | undefined =>
  new RegExp(`^\\s+${name}: (.*)$`, "m").exec(doc)?.[1];

test("the connection Secret carries exactly the contracted keys with the claim's names", async () => {
  const out = await render("compose-cloudnative-pg", {});
  const secret = out.split(/^---$/m).find((d) => /^kind: Secret$/m.test(d));
  assert.ok(secret, "a Secret is composed");
  assert.match(secret, /name: orders-db-conn/);
  const keys = secret
    .slice(secret.indexOf("stringData:"))
    .split("\n")
    .slice(1)
    .map((l) => /^ {2}(\w+):/.exec(l)?.[1])
    .filter(Boolean);
  assert.deepEqual(keys, [
    "host",
    "port",
    "database",
    "username",
    "passwordSecretRef",
    "sslmode",
  ]);
  assert.equal(field(secret, "host"), "orders-db-rw");
  assert.equal(field(secret, "passwordSecretRef"), "orders-db-app");
  assert.equal(field(secret, "sslmode"), "require");
});

test("a Retain claim selects kore-retained and a Delete claim kore-standard", async () => {
  for (const [policy, storageClass] of [
    ["Retain", "kore-retained"],
    ["Delete", "kore-standard"],
  ] as const) {
    const out = await render("compose-cloudnative-pg", {
      retentionPolicy: policy,
    });
    const cluster = out.split(/^---$/m).find((d) => /^kind: Cluster$/m.test(d));
    assert.ok(cluster, "a Cluster is composed");
    assert.equal(field(cluster, "storageClass"), storageClass, policy);
    assert.equal(
      [...cluster.matchAll(/platform\.kore\.dev\/retention: (\w+)/g)].every(
        (m) => m[1] === policy,
      ),
      true,
      "the cluster and its PVC labels carry the claim's retention policy",
    );
  }
});

test("each supported compatibility version selects its pinned image digest", async () => {
  for (const version of [16, 17, 18]) {
    const out = await render("compose-cloudnative-pg", {
      compatibilityVersion: version,
    });
    assert.match(
      field(out, "imageName") ?? "",
      new RegExp(`postgresql:${version}\\.\\d+@sha256:[0-9a-f]{64}$`),
    );
  }
});

test("a healthy database projects a True DatabaseHealthy condition and its endpoint", async () => {
  const out = await render("project-status", {
    database: { phase: "Cluster in healthy state" },
  });
  assert.equal(field(out, "endpoint"), "orders-db-rw:5432");
  assert.equal(field(out, "port"), "5432");
  assert.match(out, /status: "True"\n\s+reason: Healthy/);
});

test("a failing database projects the reason and a False condition", async () => {
  const out = await render("project-status", {
    database: { phase: "Failing over", phaseReason: "disk full" },
  });
  assert.equal(field(out, "failureReason"), '"disk full"');
  assert.match(out, /status: "False"\n\s+reason: Failed/);
});

test("a database not yet observed reports Provisioning, not healthy", async () => {
  const out = await render("project-status", {});
  assert.match(out, /status: "False"\n\s+reason: Provisioning/);
});
