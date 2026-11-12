import { loadMinikubeLocal } from "../config/minikube-local-support.js";
import { afterEach, expect, test, vi } from "vitest";

const localRegistryReferenceMock = vi.hoisted(() => vi.fn());
vi.mock("../images/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../images/index.js")>()),
  localRegistryReference: localRegistryReferenceMock,
}));

import { appUp, appUpRelease } from "./up.js";
import {
  healthyRunner,
  lockedImage,
  passthroughRegistry,
  releaseSigner,
  repositoryTrustingRelease,
  removeReleaseLocks,
  writeReleaseLock,
  type Call,
} from "./app-fixtures.js";

afterEach(removeReleaseLocks);

const helmUpgrades = (calls: Call[]) =>
  calls.filter((c) => c.command === "helm" && c.args[0] === "upgrade");
const cosignCalls = (calls: Call[]) =>
  calls.filter((c) => c.command === "cosign");

test("app up refuses a lock entry signed by the local developer key before any signature check or Helm call", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await loadMinikubeLocal();
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root, "local-kore-key");

  await expect(
    appUpRelease(repository, healthyRunner(calls), "reference", lock),
  ).rejects.toThrow(/local-kore-key.*release automation.*kore local up/s);

  expect(cosignCalls(calls)).toEqual([]);
  expect(helmUpgrades(calls)).toEqual([]);
});

test("app up refuses the committed placeholder lock, which carries the local key", async () => {
  const repository = await loadMinikubeLocal();
  const calls: Call[] = [];
  await expect(
    appUp(repository, healthyRunner(calls), "reference"),
  ).rejects.toThrow(/not release automation/);
  expect(helmUpgrades(calls)).toEqual([]);
});

test("app up deploys a release-automation lock entry offline, verifying its exact workflow identity", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await repositoryTrustingRelease();
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root);

  await appUpRelease(repository, healthyRunner(calls), "reference", lock);

  const verify = cosignCalls(calls).find((c) => c.args[0] === "verify");
  expect(verify?.args).toEqual(
    expect.arrayContaining([
      "--certificate-identity",
      releaseSigner,
      "--certificate-oidc-issuer",
      "https://token.actions.githubusercontent.com",
    ]),
  );
  expect(verify?.args).not.toContain("--key");
  expect(helmUpgrades(calls).map((c) => c.args[2])).toEqual([
    "reference-resources",
    "reference",
  ]);
});

test("a local developer-signed image is accepted only on Minikube, from kore local up", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const base = await loadMinikubeLocal();
  const managed = {
    ...base,
    environment: { ...base.environment, provider: "managed" as const },
  };
  const calls: Call[] = [];
  await expect(
    appUp(managed, healthyRunner(calls), "reference", lockedImage(), {
      publicKey: "/k.pub",
    }),
  ).rejects.toThrow(/Minikube.*local-kore-key.*managed/s);
  expect(helmUpgrades(calls)).toEqual([]);
});

test("a release-signed entry from an identity the environment does not trust is refused on local with the remedy, before Helm", async () => {
  localRegistryReferenceMock.mockImplementation(passthroughRegistry);
  const repository = await loadMinikubeLocal();
  const calls: Call[] = [];
  const lock = await writeReleaseLock(repository.root);

  await expect(
    appUpRelease(repository, healthyRunner(calls), "reference", lock),
  ).rejects.toThrow(
    /image signer .*release\.yaml@refs\/tags\/v0\.3\.1 is not trusted by environment local.*relock the image with that identity/s,
  );

  expect(cosignCalls(calls)).toEqual([]);
  expect(helmUpgrades(calls)).toEqual([]);
});
