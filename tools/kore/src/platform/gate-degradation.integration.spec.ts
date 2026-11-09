import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner } from "../runtime/index.js";
import {
  admissionGateName,
  admissionGateResource,
  assertAdmissionGateOpen,
  readAdmissionGate,
} from "./admission-gate.js";
import {
  degradationTarget,
  runKore,
  until,
} from "./gate-degradation-support.js";
import { dryRun, type Proof } from "./gate-integration-support.js";
import { closedMessage, kubectl, type Live } from "./gate-live.js";
import { readinessEvidenceName } from "./readiness-manifest.js";

// Docs: docs/decisions/0067-platform-readiness-manifest-and-evidence.md
// Live and opt-in (`npm run test:integration:gate-degradation`,
// KORE_RUN_INTEGRATION=1): needs a converged local profile (`kore local up`).
// Against the platform's own gate (not a throwaway one) it proves that a
// required capability becoming unhealthy closes the gate:
//   1. External Secrets' controller is scaled to zero (kubectl --context
//      kore-local);
//   2. `kore platform gate-check` exits non-zero, names the prerequisite and
//      closes the gate; the readiness evidence records the failure;
//   3. `kore platform status` exits non-zero, kore's own gate check refuses
//      applications, and, when the platform gate enforces (`deny`), a server
//      dry-run of an application workload as a non-administrator is denied;
//   4. a gate-check never opens the gate, even after the prerequisite is
//      restored; only `kore platform up` does, and then status exits zero.
// The scale is undone in `finally`, and a full `kore platform up` restores
// the gate if the proof stopped early. The platform gate's enforcement mode
// is never changed; while it is `dryrun` the denial check is reported as
// not exercised rather than passed.

const environment = ["--environment", "local"];
const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 45 * 60 * 1000,
};

async function replicasOf(
  cluster: Live,
  namespace: string,
  deployment: string,
): Promise<number> {
  const result = await kubectl(cluster, [
    "--namespace",
    namespace,
    "get",
    `deployment/${deployment}`,
    "--output",
    "jsonpath={.spec.replicas}",
  ]);
  assert.ok(result.ok, `read replicas of ${deployment}: ${result.output}`);
  return Number(result.output);
}

async function scale(
  cluster: Live,
  namespace: string,
  deployment: string,
  replicas: number,
): Promise<void> {
  const result = await kubectl(cluster, [
    "--namespace",
    namespace,
    "scale",
    `deployment/${deployment}`,
    `--replicas=${replicas}`,
  ]);
  assert.ok(result.ok, `scale ${deployment} to ${replicas}: ${result.output}`);
}

async function gateState(cluster: Live): Promise<string | undefined> {
  return (await readAdmissionGate(cluster.repository, cluster.runner))?.state;
}

async function evidenceState(
  cluster: Live,
): Promise<{ state: string; failures: { name: string }[] }> {
  const result = await kubectl(cluster, [
    "--namespace",
    "kore-system",
    "get",
    `configmaps/${readinessEvidenceName}`,
    "--output",
    "json",
  ]);
  assert.ok(result.ok, `read readiness evidence: ${result.output}`);
  const data = (JSON.parse(result.output) as { data?: Record<string, string> })
    .data;
  const text = Object.values(data ?? {}).find((value) =>
    value.includes('"failures"'),
  );
  assert.ok(text, "the evidence ConfigMap carries the evaluated failures");
  return JSON.parse(text) as {
    state: string;
    failures: { name: string }[];
  };
}

/** A namespace the developer may edit and no platform activation covers. */
async function applicationProof(cluster: Live, image: string): Promise<Proof> {
  const id = randomBytes(4).toString("hex");
  const namespace = `kore-gate-degrade-${id}`;
  assert.ok((await kubectl(cluster, ["create", "namespace", namespace])).ok);
  assert.ok(
    (
      await kubectl(cluster, [
        "create",
        "rolebinding",
        "kore-gate-degrade-edit",
        "--namespace",
        namespace,
        "--clusterrole",
        "edit",
        "--user",
        "kore-gate-developer",
      ])
    ).ok,
  );
  return { cluster, namespace, constraint: admissionGateName, image };
}

interface Degradation {
  cluster: Live;
  proof: Proof;
  target: ReturnType<typeof degradationTarget>;
  enforcement: string;
}

const developer = [
  "--as",
  "kore-gate-developer",
  "--as-group",
  "kore:developers",
];

async function assertClosed(run: Degradation): Promise<void> {
  const { cluster, target, proof } = run;
  const { repository, runner } = cluster;
  // The gate-check closes the gate once the readiness check notices.
  const check = await until(
    "gate-check to report the degradation",
    async () => {
      const result = await runKore([
        "platform",
        "gate-check",
        ...environment,
        "--json",
      ]);
      return result.code !== 0 ? result : undefined;
    },
  );
  assert.match(
    check.stdout + check.stderr,
    new RegExp(target.component),
    "gate-check names the failed prerequisite",
  );
  assert.equal(await gateState(cluster), "closed");
  const evidence = await evidenceState(cluster);
  assert.equal(evidence.state, "closed");
  assert.ok(
    evidence.failures.some(({ name }) => name === target.component),
    `the evidence names ${target.component}`,
  );
  const status = await runKore(["platform", "status", ...environment]);
  assert.notEqual(status.code, 0, "status cannot report success while closed");
  await assert.rejects(
    assertAdmissionGateOpen(repository, runner),
    /application admission gate is closed/,
  );
  if (run.enforcement !== "deny") {
    process.stderr.write(
      `platform gate enforcementAction is ${run.enforcement}: cluster-side denial was not exercised (ADR 0067)\n`,
    );
    return;
  }
  const denied = await until("the closed gate to deny", async () => {
    const result = await dryRun(proof, developer, "Deployment");
    return !result.ok && closedMessage.test(result.output) ? result : undefined;
  });
  assert.match(denied.output, closedMessage);
}

async function assertReopenedOnlyByUp(
  run: Degradation,
  original: number,
): Promise<void> {
  const { cluster, target } = run;
  // Restoring the prerequisite does not reopen the gate by itself.
  await scale(cluster, target.namespace, target.deployment, original);
  await kubectl(cluster, [
    "--namespace",
    target.namespace,
    "rollout",
    "status",
    `deployment/${target.deployment}`,
    "--timeout=5m",
  ]);
  await until("gate-check to see the recovery", async () =>
    (await runKore(["platform", "gate-check", ...environment])).code === 0
      ? true
      : undefined,
  );
  assert.equal(
    await gateState(cluster),
    "closed",
    "gate-check never opens the gate",
  );
  assert.notEqual(
    (await runKore(["platform", "status", ...environment])).code,
    0,
    "status stays failed until bootstrap reopens the gate",
  );
  const up = await runKore(["platform", "up", ...environment, "--yes"]);
  assert.equal(up.code, 0, `platform up reopens the gate: ${up.stderr}`);
  assert.equal(await gateState(cluster), "open");
  assert.equal((await runKore(["platform", "status", ...environment])).code, 0);
}

test(
  "a required platform capability becoming unhealthy closes the platform gate, and only kore platform up reopens it",
  live,
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    const cluster: Live = { repository, runner };
    const image = repository.approved.images[0]?.image;
    assert.ok(image, "the catalog approves at least one image");
    const target = degradationTarget(repository);
    await assertAdmissionGateOpen(repository, runner).catch((error) => {
      throw new Error(
        `run kore platform up first: the proof starts from an open gate (${String(error)})`,
        { cause: error },
      );
    });
    assert.equal(
      (await runKore(["platform", "status", ...environment])).code,
      0,
    );
    const original = await replicasOf(
      cluster,
      target.namespace,
      target.deployment,
    );
    assert.ok(original > 0, `${target.deployment} runs before the proof`);
    const enforcement = await kubectl(cluster, [
      "get",
      admissionGateResource,
      admissionGateName,
      "--output",
      "jsonpath={.spec.enforcementAction}",
    ]);
    const proof = await applicationProof(cluster, image);
    const run: Degradation = {
      cluster,
      proof,
      target,
      enforcement: enforcement.output,
    };
    try {
      await scale(cluster, target.namespace, target.deployment, 0);
      await assertClosed(run);
      await assertReopenedOnlyByUp(run, original);
    } finally {
      await scale(cluster, target.namespace, target.deployment, original).catch(
        () => undefined,
      );
      await kubectl(cluster, [
        "delete",
        "namespace",
        proof.namespace,
        "--ignore-not-found",
        "--wait=false",
      ]);
      if ((await gateState(cluster)) !== "open") {
        await runKore(["platform", "up", ...environment, "--yes"]);
      }
    }
  },
);
