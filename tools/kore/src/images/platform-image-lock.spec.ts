import { beforeEach, expect, test, vi } from "vitest";
import type { ApprovedEntry } from "../config/index.js";
import { platformImageLockErrors } from "./platform-image-lock.js";
import { isReleaseAutomationSigner } from "./release-image.js";

vi.mock("./release-image.js");

beforeEach(() => {
  vi.mocked(isReleaseAutomationSigner).mockReturnValue(true);
});

const upstreamDigest = `sha256:${"a".repeat(64)}`;
const signer =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v1.2.3";
const approved: ApprovedEntry[] = [
  {
    image: `registry:3.1.2@${upstreamDigest}`,
    name: "oci-registry",
    seed: true,
    evidence: {
      method: "docker-hub-digest",
      source: "hub",
      checked: "2026-11-08",
      provenance: { signed: false },
    },
  },
  {
    image: `ghcr.io/sigstore/pc:v1@sha256:${"b".repeat(64)}`,
    name: "policy-controller",
    seed: true,
    evidence: {
      method: "cosign-keyless",
      source: "cosign",
      checked: "2026-11-08",
      provenance: {
        signed: true,
        issuer: "https://token.actions.githubusercontent.com",
        identity: "https://github.com/sigstore/pc/.github/w.yaml@refs/tags/v1",
      },
    },
  },
];

// An approved image that is not a seed (ADR 0033 refinement): same lock shape.
const extra: ApprovedEntry = {
  image: `quay.io/jetstack/cert-manager-webhook:v1@sha256:${"e".repeat(64)}`,
  name: "cert-manager-webhook",
  seed: false,
  evidence: {
    method: "registry-digest",
    source: "crane",
    checked: "2026-11-08",
    provenance: { signed: false },
  },
};

const good = () => ({
  version: 1,
  authorizedSigners: [signer],
  entries: {
    "oci-registry": {
      upstream: "registry:3.1.2",
      upstreamDigest,
      mirror: `ghcr.io/corekraft/kore/mirror/oci-registry@${upstreamDigest}`,
      provenance: { result: "unsigned-upstream" },
      signer,
    },
    "policy-controller": {
      upstream: "ghcr.io/sigstore/pc:v1",
      upstreamDigest: `sha256:${"b".repeat(64)}`,
      mirror: `ghcr.io/corekraft/kore/mirror/policy-controller@sha256:${"b".repeat(64)}`,
      provenance: {
        result: "verified",
        issuer: "https://token.actions.githubusercontent.com",
        identity: "https://github.com/sigstore/pc/.github/w.yaml@refs/tags/v1",
      },
      signer,
    },
  },
});

test("a lock matching the approved list, with identical digests, has no errors", () => {
  expect(platformImageLockErrors(good(), approved)).toEqual([]);
});

test("a lock that is not versioned JSON with a signer is rejected", () => {
  expect(platformImageLockErrors(null, approved)[0]).toMatch(
    /must be an object/,
  );
  expect(platformImageLockErrors({ ...good(), version: 2 }, approved)).toEqual([
    expect.stringMatching(/version 1/),
  ]);
});

test("a lock missing or adding an image differs from the approved list", () => {
  const lock = good();
  delete (lock.entries as Record<string, unknown>)["oci-registry"];
  (lock.entries as Record<string, unknown>)["extra"] = {};
  const errors = platformImageLockErrors(lock, approved).join("\n");
  expect(errors).toMatch(/missing approved image oci-registry/);
  expect(errors).toMatch(/unapproved image extra/);
});

test("a mirrored digest that differs from the recorded upstream digest is rejected", () => {
  const lock = good();
  lock.entries["oci-registry"].mirror =
    `ghcr.io/corekraft/kore/mirror/oci-registry@sha256:${"c".repeat(64)}`;
  expect(platformImageLockErrors(lock, approved).join()).toMatch(
    /oci-registry: mirror digest .* differs from upstream/,
  );
});

test("an upstream digest that differs from the catalog pin is rejected", () => {
  const lock = good();
  lock.entries["oci-registry"].upstreamDigest = `sha256:${"d".repeat(64)}`;
  expect(platformImageLockErrors(lock, approved).join()).toMatch(
    /oci-registry: upstream digest .* differs from the catalog pin/,
  );
});

test("a mirror reference must be digest-only under the mirror namespace", () => {
  const lock = good();
  lock.entries["oci-registry"].mirror =
    "ghcr.io/corekraft/kore/mirror/oci-registry:v1";
  lock.entries["policy-controller"].mirror =
    `ghcr.io/corekraft/kore/other/policy-controller@sha256:${"b".repeat(64)}`;
  const errors = platformImageLockErrors(lock, approved).join("\n");
  expect(errors).toMatch(/oci-registry: mirror must be .*@sha256/);
  expect(errors).toMatch(
    /policy-controller: mirror must be under .*\/mirror\//,
  );
});

test("provenance must match what the catalog records: verified only for a signed upstream, with its identity", () => {
  const lock = good();
  lock.entries["oci-registry"].provenance = {
    result: "verified",
  } as never;
  lock.entries["policy-controller"].provenance = {
    result: "unsigned-upstream",
  } as never;
  const errors = platformImageLockErrors(lock, approved).join("\n");
  expect(errors).toMatch(
    /oci-registry: .*unsigned upstream.*unsigned-upstream/,
  );
  expect(errors).toMatch(/policy-controller: .*signed upstream.*verified/);
  lock.entries["policy-controller"].provenance = {
    result: "verified",
    issuer: "https://token.actions.githubusercontent.com",
    identity: "https://github.com/attacker/x@refs/heads/main",
  } as never;
  expect(platformImageLockErrors(lock, approved).join()).toMatch(
    /policy-controller: provenance identity/,
  );
});

test("every entry must be signed by an authorized exact tag identity", () => {
  const lock = good();
  lock.entries["oci-registry"].signer = "someone@example.com";
  const branchSigner = signer.replace("refs/tags/v1.2.3", "refs/heads/main");
  lock.authorizedSigners = [branchSigner];
  vi.mocked(isReleaseAutomationSigner).mockImplementation(
    (candidate) => candidate !== branchSigner,
  );
  const errors = platformImageLockErrors(lock, approved).join("\n");
  expect(errors).toMatch(/authorizedSigners .* refs\/tags\/vX\.Y\.Z/);
  expect(errors).toMatch(/oci-registry: signer .* not authorized/);
});

test("approved images that are not seeds are held to the same lock rules", () => {
  const withExtra = [...approved, extra];
  const lock = good();
  expect(platformImageLockErrors(lock, withExtra).join()).toMatch(
    /missing approved image cert-manager-webhook/,
  );
  (lock.entries as Record<string, unknown>)["cert-manager-webhook"] = {
    upstream: "quay.io/jetstack/cert-manager-webhook:v1",
    upstreamDigest: `sha256:${"e".repeat(64)}`,
    mirror: `ghcr.io/corekraft/kore/mirror/cert-manager-webhook@sha256:${"e".repeat(64)}`,
    provenance: { result: "unsigned-upstream" },
    signer,
  };
  expect(platformImageLockErrors(lock, withExtra)).toEqual([]);
  expect(platformImageLockErrors(lock, approved).join()).toMatch(
    /unapproved image cert-manager-webhook: not in the approved list/,
  );
});

test("the kore-link package-seeding image is never a lock entry", () => {
  const lock = good();
  (lock.entries as Record<string, unknown>)["kore-link"] = {
    upstream: "kore-link",
    upstreamDigest,
    mirror: `ghcr.io/corekraft/kore/mirror/kore-link@${upstreamDigest}`,
    provenance: { result: "unsigned-upstream" },
    signer,
  };
  expect(platformImageLockErrors(lock, approved).join()).toMatch(
    /unapproved image kore-link: not in the approved list/,
  );
});
