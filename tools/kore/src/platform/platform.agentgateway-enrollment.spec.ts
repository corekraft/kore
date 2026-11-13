import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { cluster, local } from "./agentgateway-fixtures.js";
import { enrollPlatformNamespaces } from "./enrollment.js";

/** Every Namespace manifest the platform applied, in order. */
async function applied(
  on: boolean,
  mode: "enforce" | "audit",
): Promise<string[]> {
  const repository = await local(on);
  repository.environment.imageInventory = mode;
  const { runner: base } = cluster(repository, true);
  const labelled: string[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "helm") {
        return base.run(command, args, options);
      }
      if (args.includes("namespaces")) {
        const items = repository.catalog.components.map((c) => ({
          metadata: { name: c.namespace, labels: {}, managedFields: [] },
        }));
        return { stdout: JSON.stringify({ items }), stderr: "", code: 0 };
      }
      if (args.includes("apply")) {
        labelled.push(options?.input ?? "");
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  await enrollPlatformNamespaces(repository, runner);
  return labelled;
}

/** Namespaces labelled with the image-admission inclusion label. */
async function enrolled(on: boolean): Promise<string[]> {
  return (await applied(on, "enforce"))
    .filter((manifest) => /image-policy|policy\.sigstore/.test(manifest))
    .map((manifest) => /name: (\S+)/.exec(manifest)![1]!);
}

/** Namespaces the platform labelled ambient. */
async function ambient(
  on: boolean,
  mode: "enforce" | "audit" = "audit",
): Promise<string[]> {
  return (await applied(on, mode))
    .filter((manifest) => /istio\.io\/dataplane-mode: "?ambient/.test(manifest))
    .map((manifest) => /name: (\S+)/.exec(manifest)![1]!);
}

test("with the flag on the platform labels agentgateway-system ambient, in every inventory mode", async () => {
  assert.deepEqual(await ambient(true, "audit"), ["agentgateway-system"]);
  assert.deepEqual(await ambient(true, "enforce"), ["agentgateway-system"]);
});

test("with the flag off no namespace is labelled ambient and agentgateway-system is untouched", async () => {
  assert.deepEqual(await ambient(false), []);
  const manifests = await applied(false, "enforce");
  assert.ok(
    manifests.every((manifest) => !/agentgateway-system/.test(manifest)),
  );
});

test("agentgateway-system is enrolled in image admission by default, with no exemption", async () => {
  for (const name of ["local", "managed-example"]) {
    const base = await loadRepository(name);
    assert.equal(
      base.environment.enrollmentExemptions?.["agentgateway-system"],
      undefined,
    );
  }
  assert.ok((await enrolled(true)).includes("agentgateway-system"));
  assert.ok(!(await enrolled(false)).includes("agentgateway-system"));
});
