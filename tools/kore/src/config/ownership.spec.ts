// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md (one owner per release)
import { beforeEach, expect, test, vi } from "vitest";
import { enabledComponents, featureEnabled } from "./features.js";
import { helmInstalledComponents, releaseOwner } from "./ownership.js";
import {
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
} from "./config-support.js";

vi.mock("./features.js");

const handedOver = fakeComponent({ name: "kore-local-tls", owner: "argocd" });
const kept = fakeComponent({ name: "kore-image-policy" });

beforeEach(() => {
  vi.mocked(featureEnabled).mockReturnValue(false);
  vi.mocked(enabledComponents).mockReturnValue([]);
});

test("a release that names no owner is owned by kore", () => {
  expect(releaseOwner(fakeEnvironment(), kept)).toBe("kore");
});

test("an argocd release stays owned by kore while platform-argocd-delivery is off, so nothing changes", () => {
  expect(releaseOwner(fakeEnvironment(), handedOver)).toBe("kore");
  expect(vi.mocked(featureEnabled).mock.calls).toEqual([
    [fakeEnvironment(), "platform-argocd-delivery"],
  ]);
});

test("an argocd release is owned by argocd once platform-argocd-delivery is on, and a kore release still is not", () => {
  vi.mocked(featureEnabled).mockReturnValue(true);
  expect(releaseOwner(fakeEnvironment(), handedOver)).toBe("argocd");
  expect(releaseOwner(fakeEnvironment(), kept)).toBe("kore");
});

test("Helm installs every enabled release with the flag off, whether or not the delivery release is installed", () => {
  const repository = fakeRepository();
  vi.mocked(enabledComponents).mockReturnValue([handedOver, kept]);
  expect(helmInstalledComponents(repository, false)).toEqual([
    handedOver,
    kept,
  ]);
  expect(helmInstalledComponents(repository, true)).toEqual([handedOver, kept]);
});

test("with the flag on, Helm keeps an argocd release until kore-config-delivery is installed, so no window has no owner", () => {
  const repository = fakeRepository();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(enabledComponents).mockReturnValue([handedOver, kept]);
  expect(helmInstalledComponents(repository, false)).toEqual([
    handedOver,
    kept,
  ]);
});

test("with the flag on and kore-config-delivery installed, Helm skips every argocd-owned release", () => {
  const repository = fakeRepository();
  vi.mocked(featureEnabled).mockReturnValue(true);
  vi.mocked(enabledComponents).mockReturnValue([handedOver, kept]);
  expect(helmInstalledComponents(repository, true)).toEqual([kept]);
});
