import { expect, test } from "vitest";
import { rejectedDigestErrors } from "./app-record-rules.js";

// A release's rejected list (ADR 0172): it holds digests the platform must not
// deploy again, so it never holds the digest its own component deploys. The schema
// that checks the attestation and the list's shape is the real ServiceRelease
// schema, checked by the integration spec.

const releaseFile = "infra/environments/local/services/leads.release.json";
const digest = `sha256:${"a".repeat(64)}`;
const otherDigest = `sha256:${"d".repeat(64)}`;
const attestation = `ghcr.io/corekraft/kore/leads-attestation@sha256:${"c".repeat(64)}`;

test("a rejected list holding the digest the component deploys fails, naming the component and the digest", () => {
  expect(
    rejectedDigestErrors({
      file: releaseFile,
      components: {
        frontend: { digest, attestation, rejected: [otherDigest, digest] },
      },
    }),
  ).toEqual([
    `${releaseFile}: spec.components.frontend.rejected lists the current digest ${digest}; a rejected digest must differ from the one the release deploys (ADR 0172)`,
  ]);
});

test("a rejected list of other digests has no rejection errors", () => {
  expect(
    rejectedDigestErrors({
      file: releaseFile,
      components: {
        frontend: { digest, attestation, rejected: [otherDigest] },
      },
    }),
  ).toEqual([]);
});

test("a component may reject a digest another component deploys, since the rule is per component", () => {
  expect(
    rejectedDigestErrors({
      file: releaseFile,
      components: {
        frontend: { digest, attestation },
        bff: { digest: otherDigest, attestation, rejected: [digest] },
      },
    }),
  ).toEqual([]);
});

test("a release with no rejected list has no rejection errors", () => {
  expect(
    rejectedDigestErrors({
      file: releaseFile,
      components: { frontend: { digest, attestation } },
    }),
  ).toEqual([]);
});

test("a release with no components has no rejection errors, leaving the schema to report it", () => {
  expect(
    rejectedDigestErrors({ file: releaseFile, components: undefined }),
  ).toEqual([]);
});
