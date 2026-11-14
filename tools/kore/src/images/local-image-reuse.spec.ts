import { beforeEach, expect, test, vi } from "vitest";
import type { K3dCluster } from "../config/index.js";
import type { ImageLockEntry, LockedImage } from "./image-lock.js";
import { fakeRepository, typedRunner } from "./images.fixtures.js";
import { buildAndSignLocalImage } from "./local-image.js";
import {
  k3dImageImportArgs,
  localDockerBuildArgs,
  localSignArgs,
  newRunTag,
} from "./local-image-args.js";
import { lookUpSource, sourceTag } from "./local-image-source.js";
import { withLocalSigner, type LocalSigner } from "./local-signer.js";
import {
  publishedDigest,
  publishToLocalRegistry,
  requireK3d,
  withPublishSession,
  type PublishSession,
} from "./local-publish.js";
import { localRegistryReference } from "./registry.js";

// Docs: AGENTS.md "It just works." (a no-change rerun is a no-op, not a rollout)

vi.mock("./local-image-args.js");
vi.mock("./local-image-source.js");
vi.mock("./local-signer.js");
vi.mock("./registry.js");
vi.mock("./local-publish.js");

const digest = `sha256:${"f".repeat(64)}`;
const reusedDigest = `sha256:${"e".repeat(64)}`;
const source = "kore-src-0123456789abcdef";
const entry: ImageLockEntry = {
  image: "registry.kore.local:30500/reference",
  digest: `sha256:${"a".repeat(64)}`,
  signer: "release@kore.dev",
};
const repository = fakeRepository();

/** The one cast: these collaborators' other members are never read here. */
function fake<T>(members: Partial<T>): T {
  return members as unknown as T;
}

const signer = fake<LocalSigner>({
  key: "k8s://kore-system/kore-local-signing-key",
  publicKey: "/state/local-signing.pub",
  env: {},
  kubeconfig: "KUBECONFIG",
});
const session = fake<PublishSession>({
  client: fake<PublishSession["client"]>({ env: {}, caFile: "/tmp/ca.crt" }),
});
const lock = (value: string): LockedImage => ({
  reference: `10.96.0.50:5000/reference@${value}`,
  digest: value,
  signer: "local-kore-key",
});

function lookup(found: {
  source: string | undefined;
  reused: LockedImage | undefined;
}): void {
  vi.mocked(lookUpSource).mockResolvedValue({
    repositoryPath: "reference",
    source: found.source,
    reused: found.reused,
    lock,
  });
}

const commands = (run: { mock: { calls: unknown[][] } }) =>
  run.mock.calls.map(([command, args]) => [command, args]);

const inSession: typeof withPublishSession = async (
  _repository,
  _runner,
  action,
) => await action(session);
const withSigner: typeof withLocalSigner = async (
  _repository,
  _runner,
  action,
) => await action(signer);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(localDockerBuildArgs).mockReturnValue(["build"]);
  vi.mocked(k3dImageImportArgs).mockReturnValue(["import"]);
  vi.mocked(localSignArgs).mockReturnValue(["sign"]);
  vi.mocked(newRunTag).mockReturnValue("kore-local-abc");
  vi.mocked(requireK3d).mockReturnValue(
    fake<K3dCluster>({ clusterName: "kore-local" }),
  );
  vi.mocked(withPublishSession).mockImplementation(inSession);
  vi.mocked(withLocalSigner).mockImplementation(withSigner);
  vi.mocked(localRegistryReference).mockImplementation(
    async (_repository, _runner, reference) => reference,
  );
  vi.mocked(publishToLocalRegistry).mockResolvedValue({
    address: "10.96.0.50:5000",
    repositoryPath: "reference",
  });
  vi.mocked(publishedDigest).mockResolvedValue(digest);
  vi.mocked(sourceTag).mockResolvedValue(source);
});

test("a published source is reused: no build, no import, no publish, no digest read", async () => {
  lookup({ source, reused: lock(reusedDigest) });
  const { runner, run } = typedRunner();

  const built = await buildAndSignLocalImage(
    repository,
    runner,
    "reference",
    entry,
  );

  expect(built).toEqual({
    image: lock(reusedDigest),
    publicKey: "/state/local-signing.pub",
  });
  expect(commands(run)).toEqual([["cosign", ["sign"]]]);
  expect(publishToLocalRegistry).not.toHaveBeenCalled();
  expect(publishedDigest).not.toHaveBeenCalled();
  expect(newRunTag).not.toHaveBeenCalled();
});

test("a reused image is signed again by digest, because the key may be new", async () => {
  lookup({ source, reused: lock(reusedDigest) });
  const { runner } = typedRunner();

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  expect(localSignArgs).toHaveBeenCalledWith(
    signer.key,
    `10.96.0.50:5000/reference@${reusedDigest}`,
    "/tmp/ca.crt",
  );
});

test("an unpublished source builds and publishes under the source tag the lookup named", async () => {
  lookup({ source, reused: undefined });
  const { runner, run } = typedRunner();

  const built = await buildAndSignLocalImage(
    repository,
    runner,
    "reference",
    entry,
  );

  expect(commands(run).slice(0, 2)).toEqual([
    ["docker", ["build"]],
    ["k3d", ["import"]],
  ]);
  expect(publishToLocalRegistry).toHaveBeenCalledWith(
    repository,
    runner,
    entry,
    { imageTag: "kore-local/reference:kore-local-abc", extraTags: [source] },
    session,
  );
  expect(built.image).toEqual(lock(digest));
});

test("a source that changed during the build keeps the old source tag off the new image, and says so", async () => {
  lookup({ source, reused: undefined });
  vi.mocked(sourceTag).mockResolvedValue("kore-src-fedcba9876543210");
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
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
    { imageTag: "kore-local/reference:kore-local-abc", extraTags: [] },
    session,
  );
  expect(built.image).toEqual(lock(digest)); // this run still deploys what it built
  expect(stderr).toHaveBeenCalledWith(
    "apps/reference changed during the build; this run deploys the image it built but does not tag it for reuse\n",
  );
});

test("a source that cannot be named builds, is not re-read afterwards, and publishes no source tag", async () => {
  lookup({ source: undefined, reused: undefined });
  const { runner } = typedRunner();

  await buildAndSignLocalImage(repository, runner, "reference", entry);

  expect(sourceTag).not.toHaveBeenCalled();
  expect(publishToLocalRegistry).toHaveBeenCalledWith(
    repository,
    runner,
    entry,
    { imageTag: "kore-local/reference:kore-local-abc", extraTags: [] },
    session,
  );
});

test("a registry lookup that fails fails the run before any build or signature", async () => {
  vi.mocked(lookUpSource).mockRejectedValue(new Error("HTTP 500"));
  const { runner, run } = typedRunner();

  await expect(
    buildAndSignLocalImage(repository, runner, "reference", entry),
  ).rejects.toThrow("HTTP 500");

  expect(run).not.toHaveBeenCalled();
});
