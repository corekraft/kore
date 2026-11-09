import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository, type Repository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { CommandError, ProcessRunner, type Runner } from "../runtime/index.js";
import { admissionVerdict, deployedImage } from "./admission-probe.js";
import {
  assertAdmissionGateOpen,
  closeExistingAdmissionGate,
  readAdmissionGate,
} from "./admission-gate.js";
import { platformStatus } from "./status.js";
import { platformUp } from "./up.js";

// Docs: docs/decisions/0079-live-interruption-specs.md
// Live and opt-in (`npm run test:integration:trust-loop`): needs a converged
// local profile with the `reference` application up. A bootstrap that died
// part-way leaves the gate closed with part of the trust loop missing or
// stale: Policy Controller's public-key Secret, or the registry CA it and the
// nodes trust. Each test damages one part, closes the gate, and proves one
// `platformUp` (what `kore platform up` runs) repairs it with no manual step.
// It never reads a Secret value: only key names and existence.

const application = "reference";
const trustNamespace = "cosign-system";
const keySecret = "kore-local-signing-pub";
const caConfigMap = "kore-registry-ca";

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 45 * 60 * 1000,
};

async function kubectl(
  repository: Repository,
  runner: Runner,
  args: string[],
): Promise<string> {
  const { stdout } = await runner.run(
    "kubectl",
    ["--context", repository.environment.kubeContext, ...args],
    { capture: true },
  );
  return stdout.trim();
}

/** Key names only; the values are never printed. */
async function dataKeys(
  repository: Repository,
  runner: Runner,
  kind: "secret" | "configmap",
  name: string,
): Promise<string[] | undefined> {
  try {
    return (
      await kubectl(repository, runner, [
        "--namespace",
        trustNamespace,
        "get",
        kind,
        name,
        "--output",
        "go-template={{range $key, $value := .data}}{{$key}} {{end}}",
      ])
    )
      .split(" ")
      .filter((key) => key !== "");
  } catch (error) {
    if (error instanceof CommandError && /NotFound/.test(error.result.stderr)) {
      return undefined;
    }
    throw error;
  }
}

async function assertConverged(repository: Repository, runner: Runner) {
  assert.ok(
    (await dataKeys(repository, runner, "secret", keySecret))?.includes(
      "cosign.pub",
    ),
    "the public-key Secret is back with its cosign.pub key",
  );
  assert.ok(
    (await dataKeys(repository, runner, "configmap", caConfigMap))?.includes(
      "ca.crt",
    ) ?? false,
    "the registry CA ConfigMap holds a ca.crt",
  );
  await assertAdmissionGateOpen(repository, runner);
  const names = repository.catalog.components.map(({ name }) => name);
  const broken = (await platformStatus(repository, runner, names))
    .filter(({ status }) => status !== "ready")
    .map(({ name }) => name);
  assert.deepEqual(broken, [], "every component reports ready");
  const image = await deployedImage(repository, runner, application);
  assert.equal(
    (await admissionVerdict(repository, runner, application, image)).admitted,
    true,
    "the signed workload image is admitted again",
  );
}

async function start() {
  const repository = await loadRepository("local", await findRoot());
  const runner = new ProcessRunner();
  await assertExpectedCluster(repository, runner);
  await assertAdmissionGateOpen(repository, runner);
  await deployedImage(repository, runner, application);
  return { repository, runner };
}

/** The state a bootstrap killed after it closed the gate leaves behind. */
async function leaveGateClosed(repository: Repository, runner: Runner) {
  await closeExistingAdmissionGate(repository, runner);
  const gate = await readAdmissionGate(repository, runner);
  assert.equal(gate?.state, "closed");
  await assert.rejects(
    assertAdmissionGateOpen(repository, runner),
    /gate is closed/,
    "the CLI refuses applications while the gate is closed",
  );
}

test(
  "with the gate closed and the policy-controller key Secret missing, kore platform up restores the key and opens the gate",
  live,
  async () => {
    const { repository, runner } = await start();
    await kubectl(repository, runner, [
      "--namespace",
      trustNamespace,
      "delete",
      "secret",
      keySecret,
      "--ignore-not-found",
    ]);
    await leaveGateClosed(repository, runner);
    assert.equal(
      await dataKeys(repository, runner, "secret", keySecret),
      undefined,
      "the trust loop is open: the key Secret is missing",
    );

    await platformUp(repository, runner);

    await assertConverged(repository, runner);
  },
);

test(
  "with the gate closed and the registry CA ConfigMap stale, kore platform up replaces it and opens the gate",
  live,
  async () => {
    const { repository, runner } = await start();
    await kubectl(repository, runner, [
      "--namespace",
      trustNamespace,
      "patch",
      "configmap",
      caConfigMap,
      "--type",
      "merge",
      "--patch",
      JSON.stringify({ data: { "ca.crt": "stale" } }),
    ]);
    await leaveGateClosed(repository, runner);

    await platformUp(repository, runner);

    await assertConverged(repository, runner);
  },
);
