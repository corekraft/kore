import { expect, test } from "vitest";
import {
  approvedImageList,
  loadRepository,
  type Repository,
} from "../../src/config/index.js";
import { managedLockErrors } from "../../src/images/managed-lock.js";

const MIRROR = "ghcr.io/corekraft/kore/mirror";
const SIGNER =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.1";

/** A lock as the release workflow emits it, built from the approved list. */
function lockFor(repository: Repository, signer = SIGNER, mirror = MIRROR) {
  const entries = Object.fromEntries(
    approvedImageList(repository).map((entry) => {
      const [upstream = "", digest = ""] = entry.image.split("@");
      const provenance = entry.evidence.provenance;
      return [
        entry.name,
        {
          upstream,
          upstreamDigest: digest,
          mirror: `${mirror}/${entry.name}@${digest}`,
          provenance: provenance.signed
            ? {
                result: "verified",
                issuer: provenance.issuer,
                identity: provenance.identity,
              }
            : { result: "unsigned-upstream" },
          signer,
        },
      ];
    }),
  );
  return { version: 1, authorizedSigners: [signer], entries };
}

test("a lock that matches the overlay, the approved digests, and the admitted signer is accepted", async () => {
  const repository = await loadRepository("managed-example");
  expect(managedLockErrors(lockFor(repository), repository)).toEqual([]);
});

test("a lock signed by an identity the managed policy does not admit is rejected", async () => {
  const repository = await loadRepository("managed-example");
  const other = SIGNER.replace("v0.3.1", "v9.9.9");
  expect(managedLockErrors(lockFor(repository, other), repository)).toEqual([
    expect.stringMatching(/v9\.9\.9.*not admitted by.*kore-image-policy/),
  ]);
});

test("a lock that mirrors somewhere other than the environment's platformMirror is rejected", async () => {
  const repository = await loadRepository("managed-example");
  const errors = managedLockErrors(
    lockFor(repository, SIGNER, "ghcr.io/other/mirror"),
    repository,
  );
  expect(errors.join("\n")).toMatch(
    /platformMirror ghcr\.io\/corekraft\/kore\/mirror/,
  );
});

test("a lock digest that differs from the approved digest the overlay uses is rejected", async () => {
  const repository = await loadRepository("managed-example");
  const lock = lockFor(repository);
  lock.entries["grafana"]!.mirror =
    `${MIRROR}/grafana@sha256:${"0".repeat(64)}`;
  expect(managedLockErrors(lock, repository).join("\n")).toMatch(
    /grafana: mirror digest/,
  );
});

test("an environment with no platformMirror cannot be checked against a lock", async () => {
  const repository = await loadRepository("local");
  expect(managedLockErrors(lockFor(repository), repository)).toEqual([
    expect.stringMatching(/local declares no platformMirror/),
  ]);
});
