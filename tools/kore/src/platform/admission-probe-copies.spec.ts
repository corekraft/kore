// Docs: infra/plans/14-test-tiers.md#step-2-pilots
// Docs: docs/decisions/0028-image-trust-authority.md
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import type { Repository } from "../config/index.js";
import {
  localRegistryReference,
  localSignArgs,
  publishImageCopy,
  verifiedRegistryAddress,
  withLocalSigner,
  withPublishSession,
} from "../images/index.js";
import type { Runner } from "../runtime/index.js";
import {
  publishSignedCopy,
  publishUntrustedCopies,
} from "./admission-probe-copies.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("node:path");
vi.mock("../images/index.js");

type Run = Runner["run"];

const ADDRESS = "10.96.0.50:5000";
const DIGEST = `sha256:${"a".repeat(64)}`;
const SOURCE = "kore-staged:1";
const repository = {
  environment: { name: "local" },
} as unknown as Repository;
const digest = async () => DIGEST;

// The publish session and the local signer are typed fakes: the images unit
// hands them to the callbacks, and the copies unit reads their fields.
const session = {
  client: { caFile: "/ca/registry.pem", env: { REGISTRY: "1" } },
} as never;
const signer = {
  key: "k8s://kore-system/signing",
  env: { SIGNER: "1" },
  kubeconfig: "/kube/config",
} as never;

/** A typed runner that answers every call with nothing. */
function fakeRunner() {
  const run = vi.fn<Run>(async () => ({ stdout: "", stderr: "", code: 0 }));
  return { runner: { run } as Runner, run };
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(tmpdir).mockReturnValue("/tmp");
  vi.mocked(mkdtemp).mockResolvedValue("/tmp/kore-throwaway-key-");
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(verifiedRegistryAddress).mockResolvedValue(ADDRESS);
  vi.mocked(localRegistryReference).mockImplementation(
    async (_repository, _runner, reference) => reference,
  );
  vi.mocked(localSignArgs).mockImplementation((key, reference, caFile) => [
    "sign",
    key,
    reference,
    caFile,
  ]);
  vi.mocked(publishImageCopy).mockResolvedValue(undefined as never);
  vi.mocked(withPublishSession).mockImplementation(async (_r, _run, work) =>
    work(session),
  );
  vi.mocked(withLocalSigner).mockImplementation(async (_r, _run, work) =>
    work(signer),
  );
});

test("a signed copy resolves the verified registry address before it opens the publish session", async () => {
  const { runner } = fakeRunner();

  await publishSignedCopy(repository, runner, SOURCE, "reference", { digest });

  expect(
    vi.mocked(verifiedRegistryAddress).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(withPublishSession).mock.invocationCallOrder[0]!);
});

test("a signed copy is pushed to the probe repository under its name, tagged kore-local", async () => {
  const { runner } = fakeRunner();

  await publishSignedCopy(repository, runner, SOURCE, "reference", { digest });

  expect(publishImageCopy).toHaveBeenCalledWith(
    repository,
    runner,
    {
      tag: SOURCE,
      address: ADDRESS,
      target: "kore-admission-probe/reference:kore-local",
    },
    session,
  );
});

test("a signed copy's reference is the copy's address, path and the digest the registry reports", async () => {
  const { runner } = fakeRunner();

  expect(
    await publishSignedCopy(repository, runner, SOURCE, "reference", {
      digest,
    }),
  ).toBe(`${ADDRESS}/kore-admission-probe/reference@${DIGEST}`);
});

test("the copy is signed with the cluster's signing key, the session's CA file, the merged environment and its kubeconfig", async () => {
  const { runner, run } = fakeRunner();

  await publishSignedCopy(repository, runner, SOURCE, "reference", { digest });

  expect(run).toHaveBeenCalledWith(
    "cosign",
    [
      "sign",
      "k8s://kore-system/signing",
      `${ADDRESS}/kore-admission-probe/reference@${DIGEST}`,
      "/ca/registry.pem",
    ],
    {
      capture: true,
      env: { SIGNER: "1", REGISTRY: "1" },
      kubeconfig: "/kube/config",
    },
  );
});

test("the untrusted copies are two probe repositories, unsigned and foreign-signed, each with its own digest", async () => {
  const { runner } = fakeRunner();

  const images = await publishUntrustedCopies(repository, runner, SOURCE, {
    digest,
  });

  expect(images).toEqual({
    unsigned: `${ADDRESS}/kore-admission-probe/unsigned@${DIGEST}`,
    foreignSigned: `${ADDRESS}/kore-admission-probe/foreign-signed@${DIGEST}`,
  });
  expect(publishImageCopy).toHaveBeenCalledTimes(2);
});

test("the foreign copy is signed with a key generated in a temporary directory, whose path is the only key argument", async () => {
  const { runner, run } = fakeRunner();

  await publishUntrustedCopies(repository, runner, SOURCE, { digest });

  expect(mkdtemp).toHaveBeenCalledWith("/tmp/kore-throwaway-key-");
  expect(run).toHaveBeenCalledWith(
    "cosign",
    ["generate-key-pair"],
    expect.objectContaining({ capture: true, cwd: "/tmp/kore-throwaway-key-" }),
  );
  expect(run).toHaveBeenCalledWith(
    "cosign",
    [
      "sign",
      "/tmp/kore-throwaway-key-/cosign.key",
      `${ADDRESS}/kore-admission-probe/foreign-signed@${DIGEST}`,
      "/ca/registry.pem",
    ],
    expect.objectContaining({ capture: true }),
  );
});

test("the throwaway key is generated with an empty password and the session environment, never the signer's", async () => {
  const { runner, run } = fakeRunner();

  await publishUntrustedCopies(repository, runner, SOURCE, { digest });

  const sign = run.mock.calls.find(([, args]) => args[0] === "sign");
  expect(sign?.[2]).toEqual(
    expect.objectContaining({
      env: expect.objectContaining({ COSIGN_PASSWORD: "", REGISTRY: "1" }),
    }),
  );
  expect(sign?.[2]?.env).not.toHaveProperty("SIGNER");
});

test("the temporary key directory is deleted after signing", async () => {
  const { runner } = fakeRunner();

  await publishUntrustedCopies(repository, runner, SOURCE, { digest });

  expect(rm).toHaveBeenCalledWith("/tmp/kore-throwaway-key-", {
    force: true,
    recursive: true,
  });
});

test("the temporary key directory is deleted even when signing fails, and the failure is rethrown", async () => {
  const { runner, run } = fakeRunner();
  run.mockImplementation(async (_command, args) => {
    if (args[0] === "sign") {
      throw new Error("cosign: signing failed");
    }
    return { stdout: "", stderr: "", code: 0 };
  });

  await expect(
    publishUntrustedCopies(repository, runner, SOURCE, { digest }),
  ).rejects.toThrow("cosign: signing failed");

  expect(rm).toHaveBeenCalledWith("/tmp/kore-throwaway-key-", {
    force: true,
    recursive: true,
  });
});

test("the throwaway key never leaves its directory: no returned reference names the key", async () => {
  const { runner } = fakeRunner();

  const images = await publishUntrustedCopies(repository, runner, SOURCE, {
    digest,
  });

  expect(Object.values(images).join(" ")).not.toContain("kore-throwaway-key");
});
