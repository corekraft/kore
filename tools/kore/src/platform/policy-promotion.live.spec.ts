import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  type Repository,
  promoteConstraint,
  recordPromotionEvidence,
  rollbackConstraint,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { deployedImage } from "./admission-probe.js";
import { live, namespace, read, setup } from "./identity-live.js";
import { platformUp } from "./index.js";
import { workloadVerdict } from "./workload-probe.js";

// Docs: docs/decisions/0072-constraint-promotion-procedure.md
// Live and opt-in; run: npm run test:live:policy. Needs a converged
// local profile with the `reference` application up (`kore local up`,
// `kore app up reference`). It promotes kore-workload-identity through the
// repository (the same functions `kore policy` uses), applies it with
// `platform up`, proves a default-ServiceAccount workload is rejected, rolls
// back, and proves it is admitted again. The constraint file is restored in a
// `finally`, so the working tree ends as it began; the committed constraint
// stays dryrun until the orchestrator decides to promote it.

const name = "kore-workload-identity";
const constraintFile =
  "infra/policies/gatekeeper/constraints/koreworkloadidentity.yaml";
const recordFile = `infra/policies/gatekeeper/promotions/${name}.json`;

async function until<T>(
  describe: string,
  attempt: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + 2 * 60 * 1000;
  for (;;) {
    const value = await attempt();
    if (value !== undefined) {
      return value;
    }
    assert.ok(Date.now() < deadline, `timed out waiting for ${describe}`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

/** Records the constraint's own live audit as its promotion evidence. */
async function recordLiveAudit(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const audit = await read(
    repository,
    runner,
    "get",
    "koreworkloadidentity.constraints.gatekeeper.sh",
    name,
    "--output=json",
  );
  await recordPromotionEvidence(
    repository,
    name,
    JSON.parse(audit) as Record<string, unknown>,
  );
}

test(
  "promoting kore-workload-identity rejects a default-ServiceAccount workload, and rolling back admits it again",
  live,
  async () => {
    const { repository, runner } = await setup();
    const constraintPath = join(repository.root, constraintFile);
    const recordPath = join(repository.root, recordFile);
    const originalConstraint = await readFile(constraintPath, "utf8");
    const originalRecord = await readFile(recordPath, "utf8").catch(
      () => undefined,
    );
    assert.match(
      originalConstraint,
      /enforcementAction: dryrun/,
      `${name} must start in dryrun for the round trip`,
    );
    const image = await deployedImage(repository, runner, namespace);
    const probe = () =>
      workloadVerdict(repository, runner, namespace, image, "default");
    const action = async (): Promise<string> =>
      (
        await read(
          repository,
          runner,
          "get",
          "koreworkloadidentity.constraints.gatekeeper.sh",
          name,
          "--output=jsonpath={.spec.enforcementAction}",
        )
      ).trim();

    try {
      assert.equal(
        (await probe()).admitted,
        true,
        "dryrun admits the workload",
      );

      await recordLiveAudit(repository, runner);
      await promoteConstraint(repository, name);
      await platformUp(repository, runner);
      await until("the constraint to enforce deny", async () =>
        (await action()) === "deny" ? true : undefined,
      );
      const rejected = await until(
        "the default ServiceAccount to be rejected",
        async () => {
          const verdict = await probe();
          return verdict.admitted ? undefined : verdict;
        },
      );
      assert.match(rejected.detail, /default ServiceAccount is forbidden/);

      await rollbackConstraint(repository, name);
      await platformUp(repository, runner);
      await until("the constraint to return to dryrun", async () =>
        (await action()) === "dryrun" ? true : undefined,
      );
      await until(
        "the default ServiceAccount to be admitted again",
        async () => ((await probe()).admitted ? true : undefined),
      );
    } finally {
      await writeFile(constraintPath, originalConstraint);
      if (originalRecord === undefined) {
        await rm(recordPath, { force: true });
      } else {
        await writeFile(recordPath, originalRecord);
      }
      // Converge the cluster back to the committed constraint if a failure
      // left it enforcing.
      if ((await action()) !== "dryrun") {
        await platformUp(repository, runner);
      }
    }
  },
);
