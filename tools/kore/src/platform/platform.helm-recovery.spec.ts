import { healthyWebhookOutput } from "./webhook-fixtures.js";
import assert from "node:assert/strict";
import { test } from "vitest";
import { loadRepository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import type { RunOptions, RunResult } from "../runtime/runner.js";
import { reconcileComponent, recoverUndeployedRelease } from "./reconcile.js";

const notFound = () =>
  new CommandError("helm", ["history"], {
    stdout: "",
    stderr: "Error: release: not found",
    code: 1,
  });

class HelmHistoryRunner implements Runner {
  calls: { command: string; args: readonly string[] }[] = [];
  private uninstalled = false;
  constructor(private readonly history: RunResult | Error) {}
  async run(
    command: string,
    args: readonly string[],
    _options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args });
    if (args[0] === "uninstall") {
      this.uninstalled = true;
    }
    if (args[0] === "history") {
      if (this.uninstalled) {
        throw notFound();
      }
      if (this.history instanceof Error) {
        throw this.history;
      }
      return this.history;
    }
    return { stdout: "", stderr: "", code: 0 };
  }
}

const ok = (revisions: { revision: number; status: string }[]): RunResult => ({
  stdout: JSON.stringify(revisions),
  stderr: "",
  code: 0,
});

async function policyController() {
  const repository = await loadRepository("local");
  // Patches would add a diagnostic `helm template` to a failed upgrade; these
  // specs are about the release history, so they use the component unpatched.
  const { patches: _patches, ...component } =
    repository.catalog.components.find(
      ({ name }) => name === "policy-controller",
    )!;
  return { repository, component };
}

for (const status of ["uninstalling", "pending-install", "failed"]) {
  test(`a first install interrupted as ${status} is uninstalled before reinstalling`, async () => {
    const { repository, component } = await policyController();
    const runner = new HelmHistoryRunner(ok([{ revision: 1, status }]));
    await recoverUndeployedRelease(repository, runner, component);
    const uninstall = runner.calls.find(({ args }) => args[0] === "uninstall");
    assert.ok(uninstall, "the never-deployed release is removed");
    assert.deepEqual(uninstall.args.slice(0, 2), ["uninstall", component.name]);
    for (const flag of ["--namespace", "--kube-context", "--wait"]) {
      assert.ok(uninstall.args.includes(flag), flag);
    }
    assert.ok(uninstall.args.includes(repository.environment.kubeContext));
    assert.ok(uninstall.args.includes(component.namespace));
  });
}

test("a release that was ever deployed is never uninstalled, even if its latest revision failed", async () => {
  const { repository, component } = await policyController();
  for (const earlier of ["deployed", "superseded"]) {
    const runner = new HelmHistoryRunner(
      ok([
        { revision: 1, status: earlier },
        { revision: 2, status: "failed" },
      ]),
    );
    await recoverUndeployedRelease(repository, runner, component);
    assert.equal(
      runner.calls.some(({ args }) => args[0] === "uninstall"),
      false,
    );
  }
});

test("a release that does not exist yet needs no recovery", async () => {
  const { repository, component } = await policyController();
  const runner = new HelmHistoryRunner(
    new CommandError("helm", ["history"], {
      stdout: "",
      stderr: "Error: release: not found",
      code: 1,
    }),
  );
  await recoverUndeployedRelease(repository, runner, component);
  assert.deepEqual(
    runner.calls.map(({ args }) => args[0]),
    ["history"],
  );
});

test("any other helm history failure is rethrown, not treated as a missing release", async () => {
  const { repository, component } = await policyController();
  const runner = new HelmHistoryRunner(
    new CommandError("helm", ["history"], {
      stdout: "",
      stderr: "Error: Kubernetes cluster unreachable",
      code: 1,
    }),
  );
  await assert.rejects(
    recoverUndeployedRelease(repository, runner, component),
    /cluster unreachable/,
  );
  assert.equal(
    runner.calls.some(({ args }) => args[0] === "uninstall"),
    false,
  );
});

class InterruptedInstallRunner implements Runner {
  calls: string[] = [];
  private upgrades = 0;
  private uninstalled = false;
  constructor(
    private readonly failure: string,
    private readonly history = "uninstalling",
  ) {}
  async run(command: string, args: readonly string[]): Promise<RunResult> {
    this.calls.push(`${command} ${args[0]}`);
    if (command === "helm" && args[0] === "upgrade" && this.upgrades++ === 0) {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: this.failure,
        code: 1,
      });
    }
    if (command === "helm" && args[0] === "uninstall") {
      this.uninstalled = true;
    }
    if (command === "helm" && args[0] === "history") {
      if (this.uninstalled) {
        throw notFound();
      }
      return ok([{ revision: 1, status: this.history }]);
    }
    return { stdout: healthyWebhookOutput(args) ?? "", stderr: "", code: 0 };
  }
}

// Kore streams helm output to the terminal, so the error carries no helm text.
for (const failure of [
  'Error: UPGRADE FAILED: "policy-controller" has no deployed releases',
  "",
]) {
  test(`reconcile resumes after an interrupted first install: ${failure}`, async () => {
    const { repository, component } = await policyController();
    const runner = new InterruptedInstallRunner(failure);
    await reconcileComponent(repository, runner, component);
    assert.deepEqual(
      runner.calls.filter((call) => call.startsWith("helm")),
      [
        "helm upgrade",
        "helm history",
        "helm uninstall",
        "helm history",
        "helm upgrade",
      ],
    );
  });
}

test("reconcile never uninstalls a release that was deployed before a failed upgrade", async () => {
  const { repository, component } = await policyController();
  const runner = new InterruptedInstallRunner("", "deployed");
  await assert.rejects(reconcileComponent(repository, runner, component));
  assert.deepEqual(runner.calls, ["helm upgrade", "helm history"]);
});
