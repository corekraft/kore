import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0017-gatekeeper-policy-families-audit-first.md
// Offline negative tests for the reference application: the rendered
// workloads satisfy every Gatekeeper constraint, and an invalid variant of
// them is rejected by the constraint that owns the rule. `gator test` runs the
// real templates and constraints, so this covers the invalid-workload case
// without a cluster.

const run = promisify(execFile);

interface Violation {
  constraint: string;
  msg: string;
}

// kore-workload-identity matches only activated application namespaces, so
// gator needs the namespace object to evaluate its selector.
const activatedNamespace =
  "apiVersion: v1\nkind: Namespace\nmetadata:\n  name: reference\n  labels:\n    istio.io/dataplane-mode: ambient\n    platform.kore.dev/activation-generation: g-0123456789ab\n";

async function renderedWorkloads(): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "reference-workload",
    join(root, "apps/reference/charts/workload"),
    "--set",
    "platform.gateway.hostname=kore.local",
    // `app up` always deploys by digest (ADR 0073), so render the way it does.
    "--set-string",
    `image.digest=sha256:${"a".repeat(64)}`,
  ]);
  return stdout
    .split(/^---$/m)
    .filter((doc) => /^kind: (Deployment|Job)$/m.test(doc))
    .map((doc) =>
      doc.replace(/^metadata:$/m, "metadata:\n  namespace: reference"),
    )
    .concat(activatedNamespace)
    .join("\n---\n");
}

async function violations(manifest: string): Promise<Violation[]> {
  const root = await findRoot();
  const directory = await mkdtemp(join(tmpdir(), "kore-gator-"));
  try {
    const object = join(directory, "objects.yaml");
    await writeFile(object, manifest);
    const policies = join(root, "infra/policies/gatekeeper");
    const args = [
      "test",
      "--output=json",
      `--filename=${join(policies, "templates")}`,
      `--filename=${join(policies, "constraints")}`,
      `--filename=${object}`,
    ];
    let stdout: string;
    try {
      const pending = run("gator", args);
      // gator reads stdin when it is a pipe; close it so the run ends.
      pending.child.stdin?.end();
      ({ stdout } = await pending);
    } catch (error) {
      // gator exits non-zero when it finds violations; its report is on stdout.
      const failed = error as { stdout?: string; code?: number };
      if (failed.code !== 1 || !failed.stdout) {
        throw error;
      }
      stdout = failed.stdout;
    }
    const results = (JSON.parse(stdout || "null") ?? []) as {
      msg: string;
      constraint: { metadata: { name: string } };
    }[];
    return results.map((result) => ({
      constraint: result.constraint.metadata.name,
      msg: result.msg,
    }));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("the rendered reference workloads violate no Gatekeeper constraint", async () => {
  assert.deepEqual(await violations(await renderedWorkloads()), []);
});

test("a privileged container is rejected as an invalid workload", async () => {
  const invalid = (await renderedWorkloads()).replaceAll(
    "allowPrivilegeEscalation: false",
    "allowPrivilegeEscalation: false, privileged: true",
  );

  const found = await violations(invalid);

  assert.ok(found.length > 0, "an invalid workload must be rejected");
  assert.ok(
    found.every(({ constraint }) => constraint === "kore-container-security"),
  );
  assert.match(found[0]!.msg, /must not be privileged/);
});

test("a workload on the namespace default ServiceAccount is rejected", async () => {
  const invalid = (await renderedWorkloads()).replaceAll(
    /serviceAccountName: reference-\w+/g,
    "serviceAccountName: default",
  );

  const found = await violations(invalid);

  assert.ok(found.length > 0, "the default ServiceAccount must be rejected");
  assert.ok(
    found.every(({ constraint }) => constraint === "kore-workload-identity"),
  );
});

test("a workload without a readiness probe is rejected", async () => {
  const invalid = (await renderedWorkloads()).replaceAll(
    /^\s+readinessProbe: .*$/gm,
    "",
  );

  const found = await violations(invalid);

  assert.ok(found.length > 0, "a missing readiness probe must be rejected");
  assert.match(found[0]!.msg, /readiness probe/);
});

test("a workload deployed by tag alone is rejected by the digest constraint", async () => {
  const invalid = (await renderedWorkloads()).replaceAll(
    /(image: "[^"@]+)@sha256:[a-f0-9]{64}"/g,
    '$1:0.1.0"',
  );

  const found = await violations(invalid);

  assert.ok(found.length > 0, "a tag-only image must be rejected");
  assert.ok(
    found.every(({ constraint }) => constraint === "kore-image-digest"),
  );
  assert.match(found[0]!.msg, /must be pinned by digest/);
});
