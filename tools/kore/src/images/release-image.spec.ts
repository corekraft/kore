import { expect, test } from "vitest";
import {
  assertReleaseAutomationImage,
  isReleaseAutomationSigner,
} from "./release-image.js";

const digest = "sha256:" + "a".repeat(64);
const image = (signer: string) => ({
  reference: `registry.example/reference@${digest}`,
  digest,
  signer,
});
const releaseSigner =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.3.1";

test("only an exact release-tag workflow identity is release automation", () => {
  expect(isReleaseAutomationSigner(releaseSigner)).toBe(true);
  for (const signer of [
    "local-kore-key",
    "developer@example.com",
    releaseSigner.replace("refs/tags/v0.3.1", "refs/heads/main"),
    releaseSigner.replace("refs/tags/v0.3.1", "refs/pull/1/merge"),
    `${releaseSigner}-rc1`,
    "",
  ]) {
    expect(isReleaseAutomationSigner(signer)).toBe(false);
  }
});

test("a release lock entry is accepted as is", () => {
  expect(() =>
    assertReleaseAutomationImage("reference", image(releaseSigner)),
  ).not.toThrow();
});

test("a developer-produced signature is refused with the local-build route named", () => {
  expect(() =>
    assertReleaseAutomationImage("reference", image("local-kore-key")),
  ).toThrow(/reference.*local-kore-key.*release automation.*kore local up/s);
});
