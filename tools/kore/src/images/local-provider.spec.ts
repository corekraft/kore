import { expect, test } from "vitest";
import { loadRepository, type Repository } from "../config/index.js";
import { fakeRunner } from "./local-image-fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";
import { loadLocalImage } from "./local-image.js";
import { publishImageCopy, requireK3d } from "./local-publish.js";

// Docs: docs/decisions/0083-k3d-publishes-through-the-node-containerd-client.md

const notLocal =
  /provider managed is not a local provider; local images need environment\.provider k3d and environment\.k3d \(ADR 0076\)/;

async function managedOverlay(): Promise<Repository> {
  const base = await loadRepository("local");
  return {
    ...base,
    environment: { ...base.environment, provider: "managed" },
  };
}

test("a managed provider is told what a local image needs, not to add a cluster name", async () => {
  const repository = await managedOverlay();
  expect(() => requireK3d(repository)).toThrow(notLocal);
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
    buildAndSignLocalImage(await managedOverlay(), runner, "reference", {
      image: "registry.kore.local:30500/reference",
      digest: "sha256:" + "a".repeat(64),
      signer: "s",
    }),
  ).rejects.toThrow(notLocal);
  expect(calls).toEqual([]);
});

test("loading and publishing refuse a non-k3d provider with the same message", async () => {
  const { runner } = fakeRunner();
  const repository = await managedOverlay();
  await expect(
    loadLocalImage(repository, runner, "reference", "t:kore-local"),
  ).rejects.toThrow(notLocal);
  await expect(
    publishImageCopy(
      repository,
      runner,
      { tag: "t", address: "10.96.0.50:5000", target: "x:y" },
      { credential: { username: "kore-push", password: "p" }, ca: "CA" },
    ),
  ).rejects.toThrow(notLocal);
});
