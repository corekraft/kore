import { beforeEach, expect, test, vi } from "vitest";
import { isReleaseAutomationSigner } from "../images/index.js";
import { describeSigners, isReleaseLock } from "./release-lock.js";

vi.mock("../images/index.js");

const releaseSigner =
  "https://github.com/corekraft/kore/.github/workflows/release.yaml@refs/tags/v0.10.1";
const mainSigner =
  "https://github.com/corekraft/kore/.github/workflows/charts.yaml@refs/heads/main";

beforeEach(() => {
  vi.mocked(isReleaseAutomationSigner).mockImplementation(
    (signer) => signer === releaseSigner,
  );
});

const signedBy = (...signers: unknown[]) => ({
  version: 1,
  authorizedSigners: signers,
  entries: {},
});

test("a lock whose every declared signer is release automation at a version tag is a release lock", () => {
  expect(isReleaseLock(signedBy(releaseSigner))).toBe(true);
});

test("a lock signed by a main signer is not a release lock, so a managed environment refuses it", () => {
  expect(isReleaseLock(signedBy(mainSigner))).toBe(false);
});

test("a lock that also names a non-release signer is not a release lock, since every signer must be release automation", () => {
  expect(isReleaseLock(signedBy(releaseSigner, mainSigner))).toBe(false);
});

test("a lock that names no signer, or no signer list, is not a release lock", () => {
  expect(isReleaseLock(signedBy())).toBe(false);
  expect(isReleaseLock({ version: 1, entries: {} })).toBe(false);
  expect(isReleaseLock(null)).toBe(false);
});

test("a lock whose signer is not even a string is not a release lock, and the release check is never asked about it", () => {
  vi.mocked(isReleaseAutomationSigner).mockClear();
  expect(isReleaseLock(signedBy(42))).toBe(false);
  expect(isReleaseAutomationSigner).not.toHaveBeenCalled();
});

test("describeSigners names each signer the lock declares, so the refusal says whose identity signed it", () => {
  expect(describeSigners(signedBy(mainSigner, releaseSigner))).toBe(
    `${mainSigner}, ${releaseSigner}`,
  );
});

test("describeSigners says no signer when the lock declares none", () => {
  expect(describeSigners(signedBy())).toBe("no signer");
  expect(describeSigners({ version: 1, entries: {} })).toBe("no signer");
});
