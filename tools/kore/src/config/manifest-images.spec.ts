// Docs: docs/decisions/0033-platform-image-mirror.md
import { expect, test } from "vitest";
import { manifestImages } from "./manifest-images.js";

test("block, flow and package fields are each read, in the order they appear", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const manifests = `
spec:
  package: xpkg.example/a/fn:v1@${digest}
---
spec: { package: xpkg.example/b/fn:v2 }
---
containers:
  - image: "ghcr.io/c/app:3"
`;
  expect(manifestImages(manifests)).toEqual([
    `xpkg.example/a/fn:v1@${digest}`,
    "xpkg.example/b/fn:v2",
    "ghcr.io/c/app:3",
  ]);
});

test("a block-style image field is read as its reference", () => {
  expect(manifestImages("containers:\n  - image: ghcr.io/x/app:1.2\n")).toEqual(
    ["ghcr.io/x/app:1.2"],
  );
});

test("a flow-style image field is read, and its closing brace is not part of the reference", () => {
  expect(manifestImages('{image: "ghcr.io/x/app@sha256:abc"}')).toEqual([
    "ghcr.io/x/app@sha256:abc",
  ]);
});

test("a package field, such as a Crossplane Function, counts as a reference", () => {
  expect(
    manifestImages("spec:\n  package: xpkg.upbound.io/crossplane-contrib/fn\n"),
  ).toEqual(["xpkg.upbound.io/crossplane-contrib/fn"]);
});

test("a reference that a template fills in is skipped, since its value is not known yet", () => {
  expect(
    manifestImages("image: {{ .Values.image }}\nimage: ghcr.io/x/a:1\n"),
  ).toEqual(["ghcr.io/x/a:1"]);
});

test("a reference repeated in the manifests is listed once, in order of first appearance", () => {
  expect(manifestImages("image: b:1\nimage: a:1\nimage: b:1\n")).toEqual([
    "b:1",
    "a:1",
  ]);
});

test("text with no image or package field yields no references", () => {
  expect(manifestImages("kind: Namespace\nmetadata:\n  name: kore\n")).toEqual(
    [],
  );
});

test("a key that only contains the word image is not read as an image field", () => {
  expect(manifestImages("imagePullPolicy: Always\npullImage: x:1\n")).toEqual(
    [],
  );
});
