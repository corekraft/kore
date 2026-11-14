import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { loadRepository, validateRepository } from "../config/index.js";
import { desiredFingerprint } from "./fingerprint.js";
import { helmUpgradeArgs } from "./helm.js";

// Docs: docs/decisions/0086-resources-only-releases-do-not-wait-on-claims-that-bind-later.md

async function component(name: string) {
  const repository = await loadRepository("local");
  return {
    repository,
    component: repository.catalog.components.find((c) => c.name === name)!,
  };
}

const noWait = {
  wait: false as const,
  reason: "its claim binds when Tempo starts",
};

test("a component without the helm option waits for its resources", async () => {
  const { repository, component: loki } = await component("loki");
  const args = helmUpgradeArgs(repository, loki);
  assert.ok(args.includes("--wait"));
  assert.equal(
    args.some((arg) => arg.startsWith("--wait=")),
    false,
  );
});

test("a component that opts out waits for hooks only and never sets rollback-on-failure, which would restore the wait", async () => {
  const { repository, component: config } = await component(
    "kore-observability-config",
  );
  const args = helmUpgradeArgs(repository, { ...config, helm: noWait });
  assert.ok(args.includes("--wait=hookOnly"));
  assert.equal(args.includes("--wait"), false);
  assert.equal(args.includes("--rollback-on-failure"), false);
});

test("the observability config release does not wait on the Tempo claim", async () => {
  const { repository, component: config } = await component(
    "kore-observability-config",
  );
  assert.equal(config.helm?.wait, false);
  assert.ok(config.helm?.reason);
  assert.ok(helmUpgradeArgs(repository, config).includes("--wait=hookOnly"));
});

test("Tempo's readiness still gates the volume and waits normally", async () => {
  const { repository, component: tempo } = await component("tempo");
  assert.deepEqual(tempo.readiness, ["statefulset/tempo"]);
  assert.ok(tempo.dependencies.includes("kore-observability-config"));
  assert.equal(tempo.helm?.wait, undefined);
  assert.ok(helmUpgradeArgs(repository, tempo).includes("--wait"));
});

test("only the observability config release skips waiting", async () => {
  const repository = await loadRepository("local");
  assert.deepEqual(
    repository.catalog.components
      .filter(({ helm }) => helm?.wait === false)
      .map(({ name }) => name),
    ["kore-observability-config"],
  );
});

test("skipping the wait requires a reason", async () => {
  const { repository, component: config } = await component(
    "kore-observability-config",
  );
  await assert.rejects(
    () =>
      validateRepository({
        ...repository,
        catalog: {
          ...repository.catalog,
          components: repository.catalog.components.map((c) =>
            c === config ? { ...c, helm: { wait: false } } : c,
          ),
        },
      }),
    /kore-observability-config: helm.wait false requires a reason/,
  );
});

test("the components schema requires a reason when wait is false", async () => {
  const schema = JSON.parse(
    await readFile(
      new URL(
        "../../../../infra/catalog/schemas/components.schema.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const helm = schema.properties.components.items.properties.helm;
  assert.deepEqual(helm.properties.wait, { const: false });
  assert.deepEqual(helm.required ?? [], []);
  assert.deepEqual(helm.then.required, ["reason"]);
});

test("changing the wait changes the desired-state fingerprint", async () => {
  const { repository, component: config } = await component(
    "kore-observability-config",
  );
  const { helm: _helm, ...plain } = config;
  assert.notEqual(
    desiredFingerprint(repository, { ...plain, helm: noWait }),
    desiredFingerprint(repository, plain),
  );
});
