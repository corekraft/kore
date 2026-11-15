import { beforeEach, expect, test, vi } from "vitest";
import { helmInstalledComponents } from "../config/index.js";
import { CommandError } from "../runtime/index.js";
import { handedToArgocd } from "./handover.js";
import { helmReleaseStatus } from "./probe.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js", () => ({
  configDeliveryRelease: "kore-config-delivery",
  helmInstalledComponents: vi.fn(),
}));
vi.mock("./probe.js");

const repository = fakeRepository();
const handed = fakeComponent({ name: "tls", owner: "argocd" });
const kept = fakeComponent({ name: "policy" });
const delivery = fakeComponent({ name: "kore-config-delivery" });
const candidates = [handed, delivery, kept];
const notFound = new CommandError("helm", ["status"], {
  stdout: "",
  stderr: "Error: release: not found",
  code: 1,
});

beforeEach(() => {
  // Once the delivery release is installed Helm keeps only the kore-owned ones.
  vi.mocked(helmInstalledComponents).mockReturnValue([delivery, kept]);
  vi.mocked(helmReleaseStatus).mockResolvedValue("deployed");
});

test("an argocd release is handed over once kore-config-delivery is deployed", async () => {
  const { runner } = fakeRunner();
  await expect(
    handedToArgocd(repository, runner, candidates, handed),
  ).resolves.toBe(true);
  expect(helmInstalledComponents).toHaveBeenCalledWith(repository, true);
  expect(helmReleaseStatus).toHaveBeenCalledWith(repository, runner, delivery);
});

test("a release Helm keeps is never handed over, and the cluster is not asked", async () => {
  await expect(
    handedToArgocd(repository, fakeRunner().runner, candidates, kept),
  ).resolves.toBe(false);
  expect(helmReleaseStatus).not.toHaveBeenCalled();
});

test("an argocd release stays with Helm while kore-config-delivery is not deployed, so a failed delivery leaves Helm managing it", async () => {
  vi.mocked(helmReleaseStatus).mockResolvedValue("failed");
  await expect(
    handedToArgocd(repository, fakeRunner().runner, candidates, handed),
  ).resolves.toBe(false);
});

test("with no delivery release among the candidates (the flag is off) nothing is handed over", async () => {
  await expect(
    handedToArgocd(repository, fakeRunner().runner, [handed, kept], handed),
  ).resolves.toBe(false);
  expect(helmReleaseStatus).not.toHaveBeenCalled();
});

test("a delivery release that is not found, as on a fresh profile, leaves Helm managing the argocd release", async () => {
  vi.mocked(helmReleaseStatus).mockRejectedValue(notFound);
  await expect(
    handedToArgocd(repository, fakeRunner().runner, candidates, handed),
  ).resolves.toBe(false);
});

test("any other failure reading the delivery release is rethrown, never a guess that Helm still owns the release", async () => {
  const unreachable = new CommandError("helm", ["status"], {
    stdout: "",
    stderr: "Error: Kubernetes cluster unreachable",
    code: 1,
  });
  vi.mocked(helmReleaseStatus).mockRejectedValue(unreachable);
  await expect(
    handedToArgocd(repository, fakeRunner().runner, candidates, handed),
  ).rejects.toBe(unreachable);
});
