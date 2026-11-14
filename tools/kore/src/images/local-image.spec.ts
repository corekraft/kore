import { beforeEach, expect, test, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import type { ImageLockEntry } from "./image-lock.js";
import { buildAndSignLocalImage, loadLocalImage } from "./local-image.js";
import {
  k3dImageImportArgs,
  localDockerBuildArgs,
  localSignArgs,
  newRunTag,
} from "./local-image-args.js";
import { withLocalSigner, type LocalSigner } from "./local-signer.js";
import { localRegistryReference } from "./registry.js";
import {
  publishedDigest,
  publishToLocalRegistry,
  requireK3d,
  withPublishSession,
  type PublishSession,
} from "./local-publish.js";
import { fakeRepository, typedRunner } from "./images.fixtures.js";

vi.mock("./local-image-args.js");
vi.mock("./local-signer.js");
vi.mock("./registry.js");
vi.mock("./local-publish.js");

const kubeconfig = "KUBECONFIG";
const digest = `sha256:${"f".repeat(64)}`;
const entry = {
  image: "registry.kore.local:30500/reference",
  digest: `sha256:${"a".repeat(64)}`,
  signer: "release@kore.dev",
} as ImageLockEntry;
const signer = {
  key: "k8s://kore-system/kore-local-signing-key",
  publicKey: "/state/local-signing.pub",
  env: { COSIGN_PASSWORD: "" },
  kubeconfig,
} as LocalSigner;
const session = {
  credential: { username: "kore-push", password: "pw" },
  ca: "CA",
  client: { env: { COSIGN_X: "1" }, caFile: "/tmp/ca.crt" },
} as unknown as PublishSession;
const repository = fakeRepository();

beforeEach(() => {
  vi.mocked(localDockerBuildArgs).mockReturnValue(["build"]);
  vi.mocked(k3dImageImportArgs).mockReturnValue(["import"]);
  vi.mocked(localSignArgs).mockReturnValue(["sign"]);
  vi.mocked(newRunTag).mockReturnValue("kore-local-abc");
  vi.mocked(requireK3d).mockReturnValue({
    clusterName: "kore-local",
  } as ReturnType<typeof requireK3d>);
  vi.mocked(withPublishSession).mockImplementation(
    async (_repository, _runner, action) => action(session) as never,
  );
  vi.mocked(withLocalSigner).mockImplementation(
    async (_repository, _runner, action) => action(signer) as never,
  );
  vi.mocked(localRegistryReference).mockImplementation(
    async (_repository, _runner, reference) => reference,
  );
  vi.mocked(publishToLocalRegistry).mockResolvedValue({
    address: "10.96.0.50:5000",
    repositoryPath: "reference",
  });
  vi.mocked(publishedDigest).mockResolvedValue(digest);
});

test("a local image is built from its application directory and imported into the cluster's nodes", async () => {
  const { runner, run } = typedRunner();

  await loadLocalImage(
    repository,
    runner,
    "reference",
    "kore-local/reference:run",
  );

  expect(localDockerBuildArgs).toHaveBeenCalledWith(
    "/repo/apps/reference",
    "kore-local/reference:run",
  );
  expect(k3dImageImportArgs).toHaveBeenCalledWith(
    "kore-local",
    "kore-local/reference:run",
  );
  expect(run.mock.calls).toEqual([
    ["docker", ["build"], { capture: false, cwd: "/repo" }],
    ["k3d", ["import"], { capture: false }],
  ]);
});

test("each build checks the registry reference under a run tag of its own", async () => {
  const { runner } = typedRunner();

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  expect(newRunTag).toHaveBeenCalledOnce();
  expect(localRegistryReference).toHaveBeenNthCalledWith(
    1,
    repository,
    runner,
    "registry.kore.local:30500/reference:kore-local-abc",
  );
});

test("a built image is published by its run tag and returned as the registry reference of its read-back digest", async () => {
  const { runner } = typedRunner();

  const built = await buildAndSignLocalImage(
    repository,
    runner,
    "reference",
    entry,
  );

  expect(publishToLocalRegistry).toHaveBeenCalledWith(
    repository,
    runner,
    entry,
    "kore-local/reference:kore-local-abc",
    session,
  );
  expect(publishedDigest).toHaveBeenCalledWith(
    "reference",
    session.client,
    "kore-local-abc",
  );
  expect(built).toEqual({
    image: {
      reference: `10.96.0.50:5000/reference@${digest}`,
      digest,
      signer: "local-kore-key",
    },
    publicKey: "/state/local-signing.pub",
  });
});

test("the image is signed with the local key, the pinned kubeconfig and the registry CA, and its host tag is then forgotten", async () => {
  const { runner, run } = typedRunner();

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  expect(localSignArgs).toHaveBeenCalledWith(
    signer.key,
    `10.96.0.50:5000/reference@${digest}`,
    "/tmp/ca.crt",
  );
  expect(run.mock.calls).toEqual([
    ["docker", ["build"], { capture: false, cwd: "/repo" }],
    ["k3d", ["import"], { capture: false }],
    [
      "cosign",
      ["sign"],
      {
        capture: false,
        env: { COSIGN_PASSWORD: "", COSIGN_X: "1" },
        kubeconfig,
      },
    ],
    [
      "docker",
      ["image", "rm", "kore-local/reference:kore-local-abc"],
      { capture: true },
    ],
  ]);
});

test("the host tag is removed when the build fails, and the failure is what the caller sees", async () => {
  vi.mocked(publishedDigest).mockRejectedValue(new Error("digest read failed"));
  const { runner, run } = typedRunner();

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow("digest read failed");

  expect(run.mock.calls.at(-1)).toEqual([
    "docker",
    ["image", "rm", "kore-local/reference:kore-local-abc"],
    { capture: true },
  ]);
});

test("a host tag that is already gone is not a failure, because the build itself succeeded", async () => {
  const { runner } = typedRunner((command, args) => {
    if (args[0] === "image") {
      throw new CommandError(command, args, {
        stdout: "",
        stderr: "no such image",
        code: 1,
      });
    }
    return "";
  });

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).resolves.toMatchObject({ image: { digest } });
});

test("a host tag that cannot be removed for any other reason fails the build", async () => {
  const { runner } = typedRunner((_command, args) => {
    if (args[0] === "image") {
      throw new Error("docker daemon unreachable");
    }
    return "";
  });

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow("docker daemon unreachable");
});
