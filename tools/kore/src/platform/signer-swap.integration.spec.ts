import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { swapLocalSigningKey } from "../images/index.js";
import { ProcessRunner } from "../runtime/index.js";
import {
  admissionVerdict,
  deployedImage,
  publishSignedCopy,
} from "./admission-probe.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Live and opt-in: needs a running local profile with the `reference`
// application up. It replaces the local signing key through
// `swapLocalSigningKey` (kore's own code path; no key material is read or
// written here). Afterwards the reference image stays signed with the old
// key until the next `kore app up reference`, which signs it again.

const namespace = "reference";

async function until<T>(
  description: string,
  attempt: () => Promise<T | undefined>,
  seconds = 180,
): Promise<T> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await attempt();
    if (result !== undefined) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error(`timed out after ${seconds}s waiting for ${description}`);
}

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 20 * 60 * 1000,
};

test(
  "after a local key swap an image signed only with the old key is denied and one signed with the new key is admitted",
  live,
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);

    const oldSigned = await deployedImage(repository, runner, namespace);
    assert.equal(
      (await admissionVerdict(repository, runner, namespace, oldSigned))
        .admitted,
      true,
      "the image signed with the current key is admitted before the swap",
    );

    await swapLocalSigningKey(repository, runner, { yes: true });

    const denied = await until(
      "admission to deny the image signed only with the old key",
      async () => {
        const verdict = await admissionVerdict(
          repository,
          runner,
          namespace,
          oldSigned,
        );
        return verdict.admitted ? undefined : verdict;
      },
    );
    assert.ok(denied.detail.length > 0, "the denial carries a message");

    const newSigned = await publishSignedCopy(
      repository,
      runner,
      oldSigned,
      "key-swap",
    );
    await until("admission to admit the image signed with the new key", () =>
      admissionVerdict(repository, runner, namespace, newSigned).then(
        (verdict) => (verdict.admitted ? true : undefined),
      ),
    );

    assert.equal(
      (await admissionVerdict(repository, runner, namespace, oldSigned))
        .admitted,
      false,
      "the old key is not trusted alongside the new one",
    );
  },
);
