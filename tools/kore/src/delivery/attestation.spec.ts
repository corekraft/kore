import { expect, test } from "vitest";
import { PREDICATE_TYPES, statement } from "./attestation.js";

const digest = `sha256:${"c".repeat(64)}`;

test("a statement binds the predicate to the image digest, with the sha256 hex and no prefix", () => {
  expect(
    statement({
      predicateType: PREDICATE_TYPES.flagsManifest,
      version: "1.2.3+abc1234",
      digest,
      predicate: { service: "leads", flags: [] },
    }),
  ).toEqual({
    _type: "https://in-toto.io/Statement/v1",
    subject: [{ name: "1.2.3+abc1234", digest: { sha256: "c".repeat(64) } }],
    predicateType: "urn:kore:flags-manifest:v1",
    predicate: { service: "leads", flags: [] },
  });
});

test("the eval-result predicate type is urn:kore:eval-result:v1", () => {
  expect(PREDICATE_TYPES.evalResult).toBe("urn:kore:eval-result:v1");
});

test("the migration-plan predicate type is urn:kore:migration-plan:v1, in the same statement as the others", () => {
  expect(PREDICATE_TYPES.migrationPlan).toBe("urn:kore:migration-plan:v1");
  expect(
    statement({
      predicateType: PREDICATE_TYPES.migrationPlan,
      version: "1.2.3+abc1234",
      digest,
      predicate: { release: "none" },
    }),
  ).toMatchObject({
    subject: [{ name: "1.2.3+abc1234", digest: { sha256: "c".repeat(64) } }],
    predicateType: "urn:kore:migration-plan:v1",
  });
});
