import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository } from "../config/index.js";
import { findRoot } from "../config/config.js";
import { ProcessRunner } from "../runtime/index.js";
import {
  admissionVerdict,
  deployedImage,
  publishUntrustedCopies,
} from "./admission-probe.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Live and opt-in: needs a running local profile with the `reference`
// application up (`kore local up`). It pushes two throwaway images into the
// local registry and only server-dry-runs pods; nothing is deployed.

const namespace = "reference";

test(
  "unsigned and unauthorized-key images are denied in an enrolled namespace while the kore-signed image is admitted",
  {
    concurrency: false,
    skip:
      process.env.KORE_RUN_INTEGRATION !== "1"
        ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
        : false,
    timeout: 10 * 60 * 1000,
  },
  async () => {
    const repository = await loadRepository("local", await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);

    const signed = await deployedImage(repository, runner, namespace);
    const baseline = await admissionVerdict(
      repository,
      runner,
      namespace,
      signed,
    );
    assert.equal(
      baseline.admitted,
      true,
      `the kore-signed image ${signed} must be admitted: ${baseline.detail}`,
    );

    const { unsigned, foreignSigned } = await publishUntrustedCopies(
      repository,
      runner,
      signed,
    );

    const unsignedVerdict = await admissionVerdict(
      repository,
      runner,
      namespace,
      unsigned,
    );
    assert.equal(
      unsignedVerdict.admitted,
      false,
      `an unsigned image must be denied: ${unsigned}`,
    );
    const foreignVerdict = await admissionVerdict(
      repository,
      runner,
      namespace,
      foreignSigned,
    );
    assert.equal(
      foreignVerdict.admitted,
      false,
      `an image signed by a key no policy trusts must be denied: ${foreignSigned}`,
    );
    for (const { detail } of [unsignedVerdict, foreignVerdict]) {
      assert.match(detail, /signature|no matching|policy/i);
    }
  },
);
