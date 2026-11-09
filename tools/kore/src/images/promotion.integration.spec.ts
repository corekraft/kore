import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { appUp } from "../app/index.js";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository, type Repository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { readAdmissionGate } from "../platform/index.js";
import {
  admissionVerdict,
  deployedImage,
} from "../platform/admission-probe.js";
import {
  interruptingRunner,
  ProcessRunner,
  type Runner,
} from "../runtime/index.js";
import { loadImageLock } from "./image-lock.js";
import { buildAndSignLocalImage } from "./local-image.js";
import type { ImageLockEntry } from "./image-lock.js";

// Docs: docs/decisions/0079-live-interruption-specs.md
// Live and opt-in (`npm run test:integration:promotion`): needs a running local
// profile with the `reference` application up. It kills the local
// build/sign/push mid-run, then proves nothing a failed promotion touches is
// left inconsistent (the committed release lock, the admission gate, the
// running workload) and that a rerun converges. It reads no Secret and never
// reads `.kore/`.

const application = "reference";

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 30 * 60 * 1000,
};

async function releaseLockDigest(root: string): Promise<string> {
  const bytes = await readFile(
    join(root, "infra", "catalog", "images.lock.json"),
  );
  return createHash("sha256").update(bytes).digest("hex");
}

interface Snapshot {
  lock: string;
  gate: Awaited<ReturnType<typeof readAdmissionGate>>;
  running: string;
}

async function snapshot(
  repository: Repository,
  runner: Runner,
): Promise<Snapshot> {
  const gate = await readAdmissionGate(repository, runner);
  assert.equal(
    gate?.state,
    "open",
    "run kore local up first: the gate is open",
  );
  return {
    lock: await releaseLockDigest(repository.root),
    gate,
    running: await deployedImage(repository, runner, application),
  };
}

async function assertUnchanged(
  repository: Repository,
  runner: Runner,
  before: Snapshot,
): Promise<void> {
  assert.equal(
    await releaseLockDigest(repository.root),
    before.lock,
    "a local build never alters the release lock",
  );
  assert.deepEqual(
    await readAdmissionGate(repository, runner),
    before.gate,
    "an interrupted promotion does not move the admission gate",
  );
  assert.equal(
    await deployedImage(repository, runner, application),
    before.running,
    "the running workload still uses the image it had",
  );
  assert.equal(
    (await admissionVerdict(repository, runner, application, before.running))
      .admitted,
    true,
    "the image that was already signed is still admitted",
  );
}

async function assertRerunConverges(
  repository: Repository,
  runner: Runner,
  entry: ImageLockEntry,
  lockBefore: string,
): Promise<void> {
  const built = await buildAndSignLocalImage(
    repository,
    runner,
    application,
    entry,
  );
  await appUp(repository, runner, application, built.image, {
    publicKey: built.publicKey,
  });
  // The workload names the in-cluster registry address and the lock the
  // logical one; the signed digest is what must match.
  assert.equal(
    (await deployedImage(repository, runner, application)).split("@")[1],
    built.image.reference.split("@")[1],
    "the rerun deploys the image it signed",
  );
  assert.equal(
    (
      await admissionVerdict(
        repository,
        runner,
        application,
        built.image.reference,
      )
    ).admitted,
    true,
    "the rerun's signed digest is admitted",
  );
  assert.equal(
    await releaseLockDigest(repository.root),
    lockBefore,
    "the rerun does not alter the release lock either",
  );
}

/** The steps of a local promotion, each killed once in turn. */
const steps = [
  // The push runs inside one `minikube ssh` argument, so match a substring.
  {
    name: "image push",
    command: "minikube",
    word: "nerdctl --namespace k8s.io push",
  },
  { name: "signing", command: "cosign", word: "sign" },
];

for (const step of steps) {
  test(
    `a local promotion killed during ${step.name} leaves the release lock, gate and workload unchanged and a rerun converges`,
    live,
    async () => {
      const repository = await loadRepository("local", await findRoot());
      const runner = new ProcessRunner();
      await assertExpectedCluster(repository, runner);

      const entry = (await loadImageLock(repository.root)).entries[application];
      assert.ok(entry, `the release lock has an entry for ${application}`);
      const before = await snapshot(repository, runner);

      const { runner: killing, interrupted } = interruptingRunner(runner, {
        matches: (command, args) =>
          command === step.command &&
          args.some((arg) => arg === step.word || arg.includes(step.word)),
        afterMs: 50,
      });
      await assert.rejects(
        buildAndSignLocalImage(repository, killing, application, entry),
        Error,
      );
      assert.equal(
        interrupted(),
        true,
        `the ${step.name} command was still running when it was terminated (it finished first: rerun the spec)`,
      );

      await assertUnchanged(repository, runner, before);

      await assertRerunConverges(repository, runner, entry, before.lock);
    },
  );
}
