import { healthyWebhookOutput } from "./webhook-fixtures.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { loadRepository, validateRepository } from "../config/config.js";
import type { Runner } from "../runtime/index.js";
import type { RunResult } from "../runtime/runner.js";
import { desiredFingerprint } from "./fingerprint.js";
import { helmUpgradeArgs } from "./helm.js";
import { reconcileIfNeeded } from "./reconcile.js";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });

async function policy() {
  const repository = await loadRepository("local");
  return {
    repository,
    component: repository.catalog.components.find(
      ({ name }) => name === "policy-controller",
    )!,
  };
}

const takeOver = {
  forceConflicts: true,
  reason: "the controller co-owns fields Helm must take back",
};

test("a component without the helm option never forces conflicts", async () => {
  const { repository, component } = await policy();
  const { helm: _helm, ...plain } = component;
  assert.equal(
    helmUpgradeArgs(repository, plain).includes("--force-conflicts"),
    false,
  );
  assert.equal(
    helmUpgradeArgs(repository, {
      ...plain,
      helm: { forceConflicts: false },
    }).includes("--force-conflicts"),
    false,
  );
});

test("a component that opts in upgrades with --force-conflicts", async () => {
  const { repository, component } = await policy();
  assert.ok(
    helmUpgradeArgs(repository, { ...component, helm: takeOver }).includes(
      "--force-conflicts",
    ),
  );
});

test("adding the flag changes the desired-state fingerprint", async () => {
  const { repository, component } = await policy();
  const { helm: _helm, ...plain } = component;
  assert.notEqual(
    desiredFingerprint(repository, { ...plain, helm: takeOver }),
    desiredFingerprint(repository, plain),
  );
});

test("policy-controller takes back its webhook configuration fields on upgrade", async () => {
  const { repository, component } = await policy();
  assert.equal(component.helm?.forceConflicts, true);
  assert.match(component.helm?.reason ?? "", /namespaceSelector/);
  assert.ok(
    helmUpgradeArgs(repository, component).includes("--force-conflicts"),
  );
});

test("only catalog components with a recorded reason force conflicts", async () => {
  const { repository } = await policy();
  const forced = repository.catalog.components
    .filter(({ helm }) => helm?.forceConflicts)
    .map(({ name }) => name);
  assert.deepEqual(forced, ["policy-controller"]);
});

test("forcing conflicts without a reason fails validation naming the component", async () => {
  const { repository, component } = await policy();
  await assert.rejects(
    validateRepository({
      ...repository,
      seeds: { seeds: [] },
      approved: { images: [] },
      catalog: {
        components: repository.catalog.components.map((c) =>
          c === component ? { ...c, helm: { forceConflicts: true } } : c,
        ),
      },
    }),
    /policy-controller: helm.forceConflicts requires a reason/,
  );
});

test("the components schema requires a reason when forceConflicts is true", async () => {
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
  assert.equal(helm.additionalProperties, false);
  assert.deepEqual(helm.if.anyOf[0].properties.forceConflicts, { const: true });
  assert.deepEqual(helm.then.required, ["reason"]);
});

test("a release left failed after a conflicting upgrade is upgraded, never uninstalled", async () => {
  const { repository, component } = await policy();
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: Runner = {
    async run(command, args) {
      calls.push({ command, args });
      if (args[0] === "status") {
        return ok(JSON.stringify({ info: { status: "failed" } }));
      }
      if (args[0] === "history") {
        return ok(
          JSON.stringify([
            { revision: 1, status: "deployed" },
            { revision: 2, status: "superseded" },
            { revision: 3, status: "failed" },
          ]),
        );
      }
      return ok(healthyWebhookOutput(args) ?? "ready");
    },
  };
  await reconcileIfNeeded(repository, runner, component);
  const helmCalls = calls.filter(({ command }) => command === "helm");
  assert.equal(helmCalls.filter(({ args }) => args[0] === "upgrade").length, 1);
  assert.equal(
    helmCalls.some(({ args }) => args[0] === "uninstall"),
    false,
  );
  const upgrade = helmCalls.find(({ args }) => args[0] === "upgrade")!;
  assert.ok(upgrade.args.includes("--force-conflicts"));
});
