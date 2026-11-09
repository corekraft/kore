import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { loadRepository, validateRepository } from "../config/config.js";
import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { desiredFingerprint } from "./fingerprint.js";
import { helmEnv, helmTemplateArgs, helmUpgradeArgs } from "./helm.js";
import type { ProbePatch } from "./patches.js";
import { platformRender } from "./render.js";

const patch: ProbePatch = {
  target: { kind: "Deployment", name: "cloudnative-pg", container: "manager" },
  reason: "the chart has no timeoutSeconds value",
  probes: { livenessProbe: { timeoutSeconds: 5, failureThreshold: 6 } },
};

async function component(
  name: string,
): Promise<{ repository: Repository; component: Component }> {
  const repository = await loadRepository("local");
  return {
    repository,
    component: repository.catalog.components.find((c) => c.name === name)!,
  };
}

async function validated(
  repository: Repository,
  changed: Component,
): Promise<void> {
  await validateRepository({
    ...repository,
    catalog: {
      components: repository.catalog.components.map((c) =>
        c.name === changed.name ? changed : c,
      ),
    },
  });
}

test("a component with patches renders and upgrades through the kore-patch post-renderer", async () => {
  const { repository, component: cnpg } = await component("cloudnative-pg");
  const patched = { ...cnpg, patches: [patch] };
  for (const args of [
    helmTemplateArgs(repository, patched),
    helmUpgradeArgs(repository, patched),
  ]) {
    const at = args.indexOf("--post-renderer");
    assert.equal(args[at + 1], "kore-patch");
    assert.equal(args[at + 2], "--post-renderer-args");
    assert.deepEqual(JSON.parse(args[at + 3]!), [patch]);
  }
});

test("a component without patches has no post-renderer and no plugin directory", async () => {
  const { repository, component: istiod } = await component("istiod");
  assert.equal(
    helmTemplateArgs(repository, istiod).includes("--post-renderer"),
    false,
  );
  assert.equal(helmEnv(repository, istiod), undefined);
});

test("helm finds the kore-patch plugin in the repository, not in the user's plugin directory", async () => {
  const { repository, component: cnpg } = await component("cloudnative-pg");
  const env = helmEnv(repository, { ...cnpg, patches: [patch] });
  assert.equal(
    env?.["HELM_PLUGINS"],
    join(repository.root, "infra/helm-plugins"),
  );
  const plugin = await readFile(
    join(repository.root, "infra/helm-plugins/kore-patch/plugin.yaml"),
    "utf8",
  );
  assert.match(plugin, /type: postrenderer\/v1/);
  assert.match(plugin, /name: kore-patch/);
});

test("changing a patch changes the desired-state fingerprint so resume upgrades the release", async () => {
  const { repository, component: cnpg } = await component("cloudnative-pg");
  assert.notEqual(
    desiredFingerprint(repository, { ...cnpg, patches: [patch] }),
    desiredFingerprint(repository, {
      ...cnpg,
      patches: [{ ...patch, probes: { livenessProbe: { timeoutSeconds: 9 } } }],
    }),
  );
});

test("validation rejects a patch with no reason, an unknown field, or a non-integer value, naming the component", async () => {
  const { repository, component: cnpg } = await component("cloudnative-pg");
  const bad = (changed: unknown) =>
    validated(repository, { ...cnpg, patches: [changed as ProbePatch] });
  await assert.rejects(
    bad({ ...patch, reason: " " }),
    /cloudnative-pg: patches\[0\] requires a reason/,
  );
  await assert.rejects(
    bad({ ...patch, probes: { livenessProbe: { timeout: 5 } } }),
    /cloudnative-pg: patches\[0\] livenessProbe.timeout is not a probe field/,
  );
  await assert.rejects(
    bad({ ...patch, probes: { livenessProbe: { timeoutSeconds: "5" } } }),
    /cloudnative-pg: patches\[0\] livenessProbe.timeoutSeconds must be a positive integer/,
  );
  await assert.rejects(
    bad({ ...patch, target: { ...patch.target, kind: "Pod" } }),
    /cloudnative-pg: patches\[0\] kind Pod is not patchable/,
  );
  await assert.rejects(
    bad({ ...patch, probes: { lifeProbe: { timeoutSeconds: 5 } } }),
    /cloudnative-pg: patches\[0\] lifeProbe is not a probe/,
  );
});

test("a manifest component cannot carry patches", async () => {
  const { repository, component: gateway } =
    await component("kore-gateway-api");
  await assert.rejects(
    validated(repository, { ...gateway, patches: [patch] }),
    /kore-gateway-api: patches do not apply to a manifest component/,
  );
});

test("the components schema declares patches with a required reason and no extra properties", async () => {
  const { repository } = await component("istiod");
  const schema = JSON.parse(
    await readFile(
      join(repository.root, "infra/catalog/schemas/components.schema.json"),
      "utf8",
    ),
  );
  const patches = schema.properties.components.items.properties.patches;
  assert.equal(patches.type, "array");
  assert.equal(patches.items.additionalProperties, false);
  assert.deepEqual(patches.items.required, ["target", "reason", "probes"]);
});

test("platform render shows the patched probes so the desired state is reviewable", async () => {
  const { repository, component: cnpg } = await component("cloudnative-pg");
  const calls: { args: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
  const runner: Runner = {
    async run(command, args, options) {
      if (command === "helm") {
        calls.push({ args, ...(options?.env ? { env: options.env } : {}) });
      }
      return { stdout: "", stderr: "", code: 0 };
    },
  };
  repository.catalog.components = [
    { ...cnpg, dependencies: [], patches: [patch] },
  ];
  await platformRender(repository, runner);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.args.includes("--post-renderer"));
  assert.equal(
    calls[0]!.env?.["HELM_PLUGINS"],
    join(repository.root, "infra/helm-plugins"),
  );
});

test("the catalog patches the controllers whose charts give no probe timeout value", async () => {
  const { repository } = await component("istiod");
  const patched = Object.fromEntries(
    repository.catalog.components
      .filter((c) => c.patches)
      .map((c) => [c.name, c.patches!.map((p) => p.target.name)]),
  );
  assert.deepEqual(patched, {
    "cloudnative-pg": ["cloudnative-pg"],
    "opentelemetry-operator": ["opentelemetry-operator"],
    "policy-controller": ["policy-controller-webhook"],
  });
});
