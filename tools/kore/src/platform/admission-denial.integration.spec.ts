import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCluster } from "../cluster/index.js";
import { loadRepository, noMatchPolicy } from "../config/index.js";
import { findRoot } from "../config/index.js";
import { ProcessRunner, integrationEnvironment } from "../runtime/index.js";
import {
  admissionVerdict,
  deployedImage,
  ephemeralContainerVerdict,
  modifiedDigestReference,
  publishUntrustedCopies,
  runningPodWithImage,
  tagOnlyReference,
} from "./admission-probe.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Live and opt-in: needs a running local profile with the `reference`
// application up (`kore local up`). It pushes two throwaway images into the
// local registry and only server-dry-runs requests; nothing is deployed.

const namespace = "reference";

const live = {
  concurrency: false,
  skip:
    process.env.KORE_RUN_INTEGRATION !== "1"
      ? "set KORE_RUN_INTEGRATION=1 to opt into a live local profile"
      : false,
  timeout: 10 * 60 * 1000,
};

/** A public image no ClusterImagePolicy glob matches. */
const unmatchedImage = "docker.io/library/busybox:1.37.0";

const environment = integrationEnvironment();

test(
  "unsigned and unauthorized-key images are denied in an enrolled namespace while the kore-signed image is admitted",
  live,
  async () => {
    const repository = await loadRepository(environment, await findRoot());
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

test(
  "an unsigned image is denied as an init container or an ephemeral container, and a signed one is admitted there",
  live,
  async () => {
    const repository = await loadRepository(environment, await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);

    const signed = await deployedImage(repository, runner, namespace);
    const { unsigned } = await publishUntrustedCopies(
      repository,
      runner,
      signed,
    );
    const initial = { placement: "initContainer", trusted: signed } as const;

    // Baselines: the signed image passes in the same position, so a denial
    // below is caused by the probed image alone.
    const signedInit = await admissionVerdict(
      repository,
      runner,
      namespace,
      signed,
      initial,
    );
    assert.equal(
      signedInit.admitted,
      true,
      `a signed init container must be admitted: ${signedInit.detail}`,
    );
    const unsignedInit = await admissionVerdict(
      repository,
      runner,
      namespace,
      unsigned,
      initial,
    );
    assert.equal(
      unsignedInit.admitted,
      false,
      `an unsigned image only in initContainers must be denied: ${unsigned}`,
    );
    assert.match(unsignedInit.detail, /signature|no matching|policy/i);

    const pod = await runningPodWithImage(
      repository,
      runner,
      namespace,
      signed,
    );
    const signedEphemeral = await ephemeralContainerVerdict(
      repository,
      runner,
      namespace,
      pod,
      signed,
    );
    assert.equal(
      signedEphemeral.admitted,
      true,
      `a signed ephemeral container must be admitted: ${signedEphemeral.detail}`,
    );
    const unsignedEphemeral = await ephemeralContainerVerdict(
      repository,
      runner,
      namespace,
      pod,
      unsigned,
    );
    assert.equal(
      unsignedEphemeral.admitted,
      false,
      `an unsigned image only as an ephemeral container must be denied: ${unsigned}`,
    );
    assert.match(unsignedEphemeral.detail, /signature|no matching|policy/i);
  },
);

test(
  "an image from a repository no policy matches is denied with the reason",
  live,
  async () => {
    const repository = await loadRepository(environment, await findRoot());
    const runner = new ProcessRunner();
    await assertExpectedCluster(repository, runner);
    assert.equal(
      noMatchPolicy(repository),
      "deny",
      "no-match deny is only enforced when the environment's trust.mode is enforce",
    );

    const verdict = await admissionVerdict(
      repository,
      runner,
      namespace,
      unmatchedImage,
    );
    assert.equal(
      verdict.admitted,
      false,
      `an image no ClusterImagePolicy matches must be denied: ${unmatchedImage}`,
    );
    assert.match(verdict.detail, /no matching policies/i);
  },
);

test(
  "a tag-only reference and a modified digest of the signed image are denied",
  live,
  async () => {
    const repository = await loadRepository(environment, await findRoot());
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
      `the signed digest must be admitted so a denial below is caused by the variant: ${baseline.detail}`,
    );

    for (const [what, image] of [
      ["a tag-only reference", tagOnlyReference(signed)],
      ["a modified digest", modifiedDigestReference(signed)],
    ] as const) {
      const verdict = await admissionVerdict(
        repository,
        runner,
        namespace,
        image,
      );
      assert.equal(verdict.admitted, false, `${what} must be denied: ${image}`);
    }
  },
);
