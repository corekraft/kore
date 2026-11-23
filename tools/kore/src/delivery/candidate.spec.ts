import { expect, test } from "vitest";
import { checkCandidate } from "./candidate.js";

const digest = `sha256:${"a".repeat(64)}`;
const otherDigest = `sha256:${"b".repeat(64)}`;

test("a version and digest that match the rules, with no published version to clash with, pass", () => {
  expect(
    checkCandidate({
      version: "1.2.3+abc1234",
      digest,
      published: { "1.2.2+def5678": otherDigest },
    }),
  ).toEqual({ failures: [], warnings: [] });
});

test("a rerun of a published version for the same digest is accepted, so a rerun is safe", () => {
  expect(
    checkCandidate({
      version: "1.2.3+abc1234",
      digest,
      published: { "1.2.3+abc1234": digest },
    }),
  ).toEqual({ failures: [], warnings: [] });
});

test("a published version is never reused for a different digest", () => {
  expect(
    checkCandidate({
      version: "1.2.3+abc1234",
      digest,
      published: { "1.2.3+abc1234": otherDigest },
    }),
  ).toEqual({
    failures: [
      `version 1.2.3+abc1234 is already published for ${otherDigest}; a new build needs a new version`,
    ],
    warnings: [],
  });
});

test("a version without a commit SHA is refused", () => {
  expect(checkCandidate({ version: "1.2.3", digest }).failures).toEqual([
    "version must be a semantic version plus a commit SHA, such as 1.2.3+abc1234",
  ]);
});

test("a digest that is not sha256 followed by 64 lowercase hex digits is refused", () => {
  expect(
    checkCandidate({ version: "1.2.3+abc1234", digest: "sha256:xyz" }).failures,
  ).toEqual(["digest must be sha256: followed by 64 lowercase hex digits"]);
});

test("without a published list, version reuse is not checked and the eval says so", () => {
  expect(checkCandidate({ version: "1.2.3+abc1234", digest })).toEqual({
    failures: [],
    warnings: ["version reuse not checked: no --published file was given"],
  });
});
