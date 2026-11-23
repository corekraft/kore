import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0181-namespaces-delivered-from-git-are-enrolled-in-image-admission-by-their-creator.md

// The ApplicationSet's enrolment label, rendered with templateAdmission off and
// on (ADR 0181). No cluster: helm template only.

const run = promisify(execFile);
const revision = "c".repeat(40);
const lockEntries = JSON.stringify({
  "static-frontend": {
    image: "ghcr.io/corekraft/kore/static-frontend-template",
    digest: `sha256:${"a".repeat(64)}`,
  },
  "kotlin-bff": {
    image: "ghcr.io/corekraft/kore/kotlin-bff-template",
    digest: `sha256:${"b".repeat(64)}`,
  },
});

async function applicationSet(...extra: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-delivery",
    join(root, "infra/charts/golden-path-delivery"),
    "--set",
    "repoURL=https://github.com/corekraft/kore.git",
    "--set",
    `revision=${revision}`,
    "--set",
    "environment=local",
    "--set-json",
    `templateImages=${lockEntries}`,
    ...extra,
  ]);
  return stdout;
}

test("with templateAdmission the sync labels each app namespace it creates for policy.sigstore.dev/include, so the golden-path namespaces are enrolled", async () => {
  const set = await applicationSet("--set", "templateAdmission=true");
  assert.match(
    set,
    /syncOptions:\n\s+- CreateNamespace=true\n\s+managedNamespaceMetadata:\n\s+labels:\n\s+policy\.sigstore\.dev\/include: "true"\n/,
  );
});

test("with templateAdmission and sharedGateway both on, one labels map carries both namespace labels", async () => {
  const set = await applicationSet(
    "--set",
    "templateAdmission=true",
    "--set",
    "sharedGateway=true",
  );
  assert.match(
    set,
    /managedNamespaceMetadata:\n\s+labels:\n\s+platform\.kore\.dev\/shared-gateway: "true"\n\s+policy\.sigstore\.dev\/include: "true"\n/,
  );
});

test("without templateAdmission the sync adds no enrolment label, so the golden-path namespaces stay unenrolled", async () => {
  const set = await applicationSet();
  assert.doesNotMatch(set, /policy\.sigstore\.dev\/include/);
});
