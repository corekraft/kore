import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md
// The golden-path ApplicationSet reads infra/services/*.yaml; each file is a
// Service the platform-apis XRD accepts (JSON-compatible YAML, AGENTS.md).

async function registrations(): Promise<Record<string, unknown>[]> {
  const directory = join(await findRoot(), "infra/services");
  const files = (await readdir(directory)).filter((f) => f.endsWith(".yaml"));
  return await Promise.all(
    files.map(
      async (file) =>
        JSON.parse(await readFile(join(directory, file), "utf8")) as Record<
          string,
          unknown
        >,
    ),
  );
}

test("every Service registration is a platform Service the XRD admits", async () => {
  const all = await registrations();
  assert.ok(all.length > 0, "at least one registration exists");
  for (const service of all) {
    const metadata = service["metadata"] as { name: string };
    const spec = service["spec"] as {
      organization: string;
      environments: string[];
    };
    assert.equal(service["apiVersion"], "platform.kore.dev/v1alpha1");
    assert.equal(service["kind"], "Service");
    assert.match(metadata.name, /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/);
    assert.ok(!metadata.name.includes("--"));
    assert.ok(!/^(kube|kore)-/.test(metadata.name));
    assert.equal(spec.organization, "platform");
    assert.ok(spec.environments.length > 0);
  }
});
