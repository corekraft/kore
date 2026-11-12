import { expect, test } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import { fakeRunner } from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";
import { loadLocalImage } from "./local-image.js";
import { publishImageCopy, requireK3d } from "./local-publish.js";

// Docs: docs/decisions/0076-k3d-replaces-minikube.md

const retired =
  /provider minikube is no longer a local provider; set environment\.provider to k3d and add environment\.k3d \(ADR 0076\)/;

async function retiredOverlay(): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: { ...base.environment, provider: "minikube" },
  };
}

test("a retired provider is told to move to k3d, not to add a cluster name", async () => {
  const repository = await retiredOverlay();
  expect(() => requireK3d(repository)).toThrow(retired);
});

test("a k3d overlay without k3d settings is told to add the cluster name", async () => {
  const base = await loadRepository("local");
  const { k3d: _k3d, ...environment } = base.environment;
  expect(() => requireK3d({ ...base, environment })).toThrow(
    /environment\.k3d\.clusterName/,
  );
});

test("image build fails before any command when the provider is not k3d", async () => {
  const { runner, calls } = fakeRunner();
  await expect(
    buildAndSignLocalImage(await retiredOverlay(), runner, "reference", {
      image: "registry.kore.local:30500/reference",
      digest: "sha256:" + "a".repeat(64),
      signer: "s",
    }),
  ).rejects.toThrow(retired);
  expect(calls).toEqual([]);
});

test("loading and publishing refuse a non-k3d provider with the same message", async () => {
  const { runner } = fakeRunner();
  const repository = await retiredOverlay();
  await expect(
    loadLocalImage(repository, runner, "reference", "t:kore-local"),
  ).rejects.toThrow(retired);
  await expect(
    publishImageCopy(
      repository,
      runner,
      { tag: "t", address: "10.96.0.50:5000", target: "x:y" },
      { credential: { username: "kore-push", password: "p" }, ca: "CA" },
    ),
  ).rejects.toThrow(retired);
});
