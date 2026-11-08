import { healthyWebhookOutput } from "./webhook-fixtures.js";
import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, test } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import type { RunResult } from "../runtime/runner.js";
import { desiredFingerprint } from "./fingerprint.js";
import { reconcileIfNeeded } from "./reconcile.js";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", code: 0 });

/** A fake cluster whose single release is deployed with a given description. */
class DeployedRunner implements Runner {
  calls: { command: string; args: readonly string[] }[] = [];
  constructor(
    private readonly description: string,
    private readonly historyError?: Error,
  ) {}
  async run(command: string, args: readonly string[]): Promise<RunResult> {
    this.calls.push({ command, args });
    if (command === "helm" && args[0] === "status") {
      return ok(JSON.stringify({ info: { status: "deployed" } }));
    }
    if (command === "helm" && args[0] === "history") {
      if (this.historyError) {
        throw this.historyError;
      }
      return ok(
        JSON.stringify([
          {
            revision: 1,
            status: "superseded",
            description: "Install complete",
          },
          { revision: 2, status: "deployed", description: this.description },
        ]),
      );
    }
    return ok(healthyWebhookOutput(args) ?? "ready");
  }
  upgrades() {
    return this.calls.filter(
      ({ command, args }) => command === "helm" && args[0] === "upgrade",
    );
  }
}

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function component(name: string) {
  const repository = await loadRepository("local");
  return {
    repository,
    component: repository.catalog.components.find((c) => c.name === name)!,
  };
}

test("a deployed release whose desired state is unchanged is not upgraded", async () => {
  const { repository, component: policy } =
    await component("policy-controller");
  const runner = new DeployedRunner(desiredFingerprint(repository, policy));
  await reconcileIfNeeded(repository, runner, policy);
  assert.equal(runner.upgrades().length, 0);
});

test("a deployed release with stale desired state is upgraded with the new fingerprint", async () => {
  const { repository, component: policy } =
    await component("policy-controller");
  const runner = new DeployedRunner("kore desired-state sha256:stale");
  await reconcileIfNeeded(repository, runner, policy);
  const [upgrade] = runner.upgrades();
  assert.ok(upgrade, "changed values roll out");
  const at = upgrade.args.indexOf("--description");
  assert.equal(upgrade.args[at + 1], desiredFingerprint(repository, policy));
});

test("a release deployed before fingerprints existed is upgraded once", async () => {
  const { repository, component: policy } =
    await component("policy-controller");
  const runner = new DeployedRunner("Upgrade complete");
  await reconcileIfNeeded(repository, runner, policy);
  assert.equal(runner.upgrades().length, 1);
});

test("a changed chart version changes the fingerprint", async () => {
  const { repository, component: policy } =
    await component("policy-controller");
  const bumped = { ...policy, version: `${policy.version}-next` };
  assert.notEqual(
    desiredFingerprint(repository, bumped),
    desiredFingerprint(repository, policy),
  );
});

test("a changed values file changes the fingerprint and a changed checkout path does not", async () => {
  const { repository, component: policy } =
    await component("policy-controller");
  const copy = await mkdtemp(join(tmpdir(), "kore-drift-"));
  temporary.push(copy);
  await cp(repository.root + "/infra", join(copy, "infra"), {
    recursive: true,
  });
  const moved: Repository = { ...repository, root: copy };
  const before = desiredFingerprint(repository, policy);
  assert.equal(desiredFingerprint(moved, policy), before);
  const values = (policy.values ?? [])[0];
  assert.ok(values, "policy-controller has a values file");
  await appendFile(join(copy, values), "\n# changed\n");
  assert.notEqual(desiredFingerprint(moved, policy), before);
});

test("a changed local chart template changes the fingerprint", async () => {
  const { repository, component: registry } = await component("oci-registry");
  const copy = await mkdtemp(join(tmpdir(), "kore-drift-"));
  temporary.push(copy);
  await cp(repository.root + "/infra", join(copy, "infra"), {
    recursive: true,
  });
  const moved: Repository = { ...repository, root: copy };
  const before = desiredFingerprint(moved, registry);
  await writeFile(
    join(copy, registry.chart!, "templates", "added.yaml"),
    "# new template\n",
  );
  assert.notEqual(desiredFingerprint(moved, registry), before);
});

test("a failure reading the deployed release is reported, not treated as drift or as current", async () => {
  const { repository, component: policy } =
    await component("policy-controller");
  const runner = new DeployedRunner(
    "",
    new CommandError("helm", ["history"], {
      stdout: "",
      stderr: "Error: Kubernetes cluster unreachable",
      code: 1,
    }),
  );
  await assert.rejects(
    reconcileIfNeeded(repository, runner, policy),
    /policy-controller.*unreachable/s,
  );
  assert.equal(runner.upgrades().length, 0);
});
