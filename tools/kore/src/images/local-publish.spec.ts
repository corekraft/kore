import { beforeEach, expect, test, vi } from "vitest";
import type { RegistryCredential } from "./registry-auth.js";
import type { RegistryClient } from "./registry-client.js";
import {
  imageDigestFromRegistryHead,
  k3dImagePublishArgs,
} from "./local-image-args.js";
import {
  loadRegistryCredential,
  withSecretsRedacted,
} from "./registry-auth.js";
import { withRegistryClient } from "./registry-client.js";
import { verifiedRegistryAddress } from "./registry-service.js";
import { loadRegistryCa } from "./registry-tls.js";
import {
  publishedDigest,
  publishImageCopy,
  publishToLocalRegistry,
  requireK3d,
  withPublishSession,
} from "./local-publish.js";
import { fakeRepository, typedRunner } from "./images.fixtures.js";
import type { ImageLockEntry } from "./image-lock.js";

vi.mock("./local-image-args.js");
vi.mock("./registry-auth.js");
vi.mock("./registry-client.js");
vi.mock("./registry-service.js");
vi.mock("./registry-tls.js");

const digest = `sha256:${"e".repeat(64)}`;
const basic = Buffer.from("kore-push:pw").toString("base64");
const credential = {
  username: "kore-push",
  password: "pw",
} as RegistryCredential;
const entry = {
  image: "registry.kore.local:30500/reference",
  digest,
  signer: "release@kore.dev",
} as ImageLockEntry;

const client = {
  authorization: "Basic xyz",
  head: vi.fn(async () => ({ status: 200, digest })),
} as unknown as RegistryClient;

beforeEach(() => {
  vi.mocked(withSecretsRedacted).mockImplementation((_secrets, operation) =>
    operation(),
  );
  vi.mocked(loadRegistryCredential).mockResolvedValue(credential);
  vi.mocked(loadRegistryCa).mockResolvedValue("CA");
  vi.mocked(verifiedRegistryAddress).mockResolvedValue("10.96.0.50:5000");
  vi.mocked(k3dImagePublishArgs).mockReturnValue(["publish"]);
  vi.mocked(withRegistryClient).mockImplementation(
    async (_credential, _ca, action) => action(client),
  );
});

test("the k3d settings are returned for a k3d environment", () => {
  expect(requireK3d(fakeRepository())).toEqual({ clusterName: "kore-local" });
});

test("a provider other than k3d is refused, naming the settings a local image needs", () => {
  expect(() => requireK3d(fakeRepository({ provider: "managed" }))).toThrow(
    /provider managed is not a local provider; local images need environment.provider k3d/,
  );
});

test("a k3d overlay without k3d settings is refused, naming the setting to add", () => {
  expect(() => requireK3d(fakeRepository({ k3d: undefined }))).toThrow(
    /environment local is a k3d overlay without environment.k3d settings; add environment.k3d.clusterName/,
  );
});

test("a publish session refuses a non-k3d provider before any registry credential is loaded", async () => {
  const action = vi.fn();

  await expect(
    withPublishSession(
      fakeRepository({ provider: "managed" }),
      typedRunner().runner,
      action,
    ),
  ).rejects.toThrow(/not a local provider/);

  expect(loadRegistryCredential).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
});

test("a publish session loads the push credential and the registry CA, then hands the action its client", async () => {
  const { runner } = typedRunner();
  const repository = fakeRepository();

  const result = await withPublishSession(
    repository,
    runner,
    async (session) => {
      expect(session).toEqual({ credential, ca: "CA", client });
      return "published";
    },
  );

  expect(result).toBe("published");
  expect(loadRegistryCredential).toHaveBeenCalledWith(
    repository,
    runner,
    "push",
  );
  expect(loadRegistryCa).toHaveBeenCalledWith(repository, runner);
  expect(withRegistryClient).toHaveBeenCalledWith(
    credential,
    "CA",
    expect.any(Function),
  );
});

test("a publish refuses a push username that is not lowercase letters, digits and hyphens", async () => {
  const { runner, run } = typedRunner();

  await expect(
    publishImageCopy(
      fakeRepository(),
      runner,
      {
        tag: "kore-local/reference:run",
        address: "10.96.0.50:5000",
        target: "reference:run",
      },
      { credential: { username: "Kore_Push", password: "pw" }, ca: "CA" },
    ),
  ).rejects.toThrow(/invalid username/);

  expect(run).not.toHaveBeenCalled();
});

test("a publish runs the node's containerd client with the Basic credential on stdin and redacts both secrets", async () => {
  const { runner, run } = typedRunner();

  await publishImageCopy(
    fakeRepository(),
    runner,
    {
      tag: "kore-local/reference:run",
      address: "10.96.0.50:5000",
      target: "reference:run",
    },
    { credential, ca: "CA" },
  );

  expect(withSecretsRedacted).toHaveBeenCalledWith(
    ["pw", basic],
    expect.any(Function),
  );
  expect(k3dImagePublishArgs).toHaveBeenCalledWith(
    "kore-local",
    "kore-local/reference:run",
    "10.96.0.50:5000",
    "reference:run",
    "CA",
  );
  expect(run.mock.calls).toEqual([
    ["docker", ["publish"], { capture: true, input: `${basic}\n` }],
  ]);
});

test("a publish to the local registry pushes under the entry's repository and the run's tag", async () => {
  const { runner } = typedRunner();

  const published = await publishToLocalRegistry(
    fakeRepository(),
    runner,
    entry,
    "kore-local/reference:run",
    { credential, ca: "CA" },
  );

  expect(published).toEqual({
    address: "10.96.0.50:5000",
    repositoryPath: "reference",
  });
  expect(k3dImagePublishArgs).toHaveBeenCalledWith(
    "kore-local",
    "kore-local/reference:run",
    "10.96.0.50:5000",
    "reference:run",
    "CA",
  );
});

test("a publish refuses an image entry with no repository path after the registry host", async () => {
  const { runner } = typedRunner();

  await expect(
    publishToLocalRegistry(
      fakeRepository(),
      runner,
      { ...entry, image: "registry.kore.local" },
      "kore-local/reference:run",
      { credential, ca: "CA" },
    ),
  ).rejects.toThrow("image repository path is unavailable");
});

test("the digest is read back from the tag this run pushed, through the registry client", async () => {
  vi.mocked(imageDigestFromRegistryHead).mockReturnValue(digest);

  const found = await publishedDigest("team/reference", client, "run");

  expect(found).toBe(digest);
  expect(client.head).toHaveBeenCalledWith(
    "https://127.0.0.1:30500/v2/team/reference/manifests/run",
    {
      Accept: expect.stringContaining(
        "application/vnd.oci.image.index.v1+json",
      ),
      Authorization: "Basic xyz",
    },
  );
  expect(imageDigestFromRegistryHead).toHaveBeenCalledWith(
    200,
    `docker-content-digest: ${digest}`,
  );
});
