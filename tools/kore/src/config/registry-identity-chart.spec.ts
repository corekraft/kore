import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "./config.js";

// Docs: infra/policies/gatekeeper/templates/koreworkloadidentity.yaml

async function all(): Promise<string> {
  return await readFile(
    join(await findRoot(), "infra/charts/oci-registry/templates/all.yaml"),
    "utf8",
  );
}

test("the registry runs as its own ServiceAccount, never the namespace default", async () => {
  const chart = await all();
  assert.doesNotMatch(chart, /serviceAccountName:\s*default\b/);
  assert.match(
    chart,
    /kind: ServiceAccount\s*\n\s*metadata:\s*\n\s*name: oci-registry\b/,
  );
  assert.match(chart, /serviceAccountName: oci-registry\b/);
});

test("the registry never mounts a Kubernetes API token: it does not call the API", async () => {
  const chart = await all();
  assert.match(
    chart,
    /kind: ServiceAccount[\s\S]*?automountServiceAccountToken: false/,
  );
  assert.match(
    chart,
    /spec:\s*\n\s*serviceAccountName: oci-registry\s*\n\s*automountServiceAccountToken: false/,
  );
});
