import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository, type Repository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import {
  interruptingRunner,
  ProcessRunner,
  type Runner,
} from "../runtime/index.js";
import { readAdmissionGate } from "./admission-gate.js";
import { helmReleaseStatus } from "./probe.js";
import { reconcileComponent } from "./reconcile.js";
import { platformStatus } from "./status.js";
import { platformUp } from "./up.js";

// Docs: docs/decisions/0079-live-interruption-specs.md
// Live and opt-in (`npm run test:integration:helm-interrupt`): needs a
// converged local profile. It kills `helm upgrade` of one platform release
// mid-run (every attempt in the run, so kore's own in-run retry is killed too)
// and proves the next run repairs the release through
// `recoverUndeployedRelease` (platform.helm-recovery) and converges with no
// manual step. The release is the OPA authorizer: it has no dependents and
// its outage is already proven degraded-only (resilience suite).

const target = "opa-authorizer";

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 45 * 60 * 1000,
};

async function brokenComponents(
  repository: Repository,
  runner: Runner,
): Promise<string[]> {
  const names = repository.catalog.components.map(({ name }) => name);
  return (await platformStatus(repository, runner, names))
    .filter(({ status }) => status !== "ready")
    .map(({ name }) => name);
}

async function makeStale(
  repository: Awaited<ReturnType<typeof loadRepository>>,
  runner: Runner,
  namespace: string,
): Promise<void> {
  const base = [
    "--kube-context",
    repository.environment.kubeContext,
    "--namespace",
    namespace,
  ];
  const history = JSON.parse(
    (
      await runner.run(
        "helm",
        [...base, "history", target, "--output", "json"],
        {
          capture: true,
        },
      )
    ).stdout,
  ) as { revision: number }[];
  const current = history.at(-1)?.revision;
  assert.ok(current, `${target} has a release history`);
  await runner.run(
    "helm",
    [...base, "rollback", target, String(current), "--wait", "--timeout", "5m"],
    { capture: true },
  );
}

async function session() {
  const repository = await loadRepository("local", await findRoot());
  const runner = new ProcessRunner();
  await assertExpectedCluster(repository, runner);
  const component = repository.catalog.components.find(
    ({ name }) => name === target,
  );
  assert.ok(
    component && component.kind !== "manifest",
    `${target} is a Helm release`,
  );
  assert.deepEqual(
    await brokenComponents(repository, runner),
    [],
    "the platform must be healthy before the spec",
  );
  // A converged release is skipped (its latest revision's description is the
  // desired fingerprint), so nothing would upgrade. A same-revision rollback
  // keeps the content but records a new description, which makes the next
  // reconcile upgrade the release for real.
  await makeStale(repository, runner, component.namespace);
  const killing = (inner: Runner) =>
    interruptingRunner(inner, {
      matches: (command, args) =>
        command === "helm" && args[0] === "upgrade" && args.includes(target),
      afterMs: 1500,
      times: 1000,
    });
  return { repository, runner, component, killing };
}

test(
  "a Helm upgrade killed mid-run is recovered and the rerun converges to a deployed, ready release",
  live,
  async () => {
    const { repository, runner, component, killing } = await session();
    const { runner: interrupting, interrupted } = killing(runner);

    await assert.rejects(
      reconcileComponent(repository, interrupting, component),
      Error,
    );
    assert.equal(
      interrupted(),
      true,
      "helm upgrade was still running when it was terminated (it finished first: rerun the spec)",
    );

    await reconcileComponent(repository, runner, component);

    assert.equal(
      await helmReleaseStatus(repository, runner, component),
      "deployed",
      "the release is deployed again, not stuck in pending-upgrade or failed",
    );
    assert.deepEqual(await brokenComponents(repository, runner), []);
  },
);

test(
  "a platform up killed part-way leaves the gate closed and the next platform up converges and opens it",
  live,
  async () => {
    const { repository, runner, killing } = await session();
    const { runner: interrupting, interrupted } = killing(runner);

    await assert.rejects(platformUp(repository, interrupting), Error);
    assert.equal(interrupted(), true, "the upgrade was interrupted");
    assert.equal(
      (await readAdmissionGate(repository, runner))?.state,
      "closed",
      "an interrupted bootstrap leaves the application admission gate closed",
    );

    await platformUp(repository, runner);

    assert.equal((await readAdmissionGate(repository, runner))?.state, "open");
    assert.deepEqual(await brokenComponents(repository, runner), []);
  },
);
