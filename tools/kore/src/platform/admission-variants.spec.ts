import assert from "node:assert/strict";
import { test } from "vitest";
import {
  modifiedDigestReference,
  tagOnlyReference,
} from "./admission-probe.js";

// Docs: docs/decisions/0028-image-trust-authority.md
// Reference variants of a signed image for the opt-in live admission specs.

const hex = "c".repeat(63);
const signed = `10.96.0.50:5000/reference@sha256:${hex}c`;

test("a tag-only reference keeps the repository and drops the digest", () => {
  const tagOnly = tagOnlyReference(signed);

  assert.equal(tagOnly, "10.96.0.50:5000/reference:kore-local");
  assert.doesNotMatch(tagOnly, /@sha256:/);
});

test("a tag-only reference keeps a registry port that looks like a tag", () => {
  assert.equal(
    tagOnlyReference(`registry.kore.local:30500/reference@sha256:${hex}c`, "9"),
    "registry.kore.local:30500/reference:9",
  );
});

test("a modified digest keeps the repository and changes exactly one digest character", () => {
  const modified = modifiedDigestReference(signed);

  assert.notEqual(modified, signed);
  assert.match(modified, /^10\.96\.0\.50:5000\/reference@sha256:[0-9a-f]{64}$/);
  const [before, after] = [signed, modified].map(
    (image) => image.split("@sha256:")[1]!,
  );
  assert.equal(
    before!.split("").filter((char, index) => char !== after![index]).length,
    1,
  );
});

test("a modified digest never equals the original even when the last character is f", () => {
  const original = `host/reference@sha256:${"f".repeat(64)}`;

  assert.notEqual(modifiedDigestReference(original), original);
});

test("variants refuse a reference that carries no digest", () => {
  assert.throws(() => tagOnlyReference("host/reference:tag"), /digest/);
  assert.throws(() => modifiedDigestReference("host/reference:tag"), /digest/);
});
