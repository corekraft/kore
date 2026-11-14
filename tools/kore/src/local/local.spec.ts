// Docs: infra/plans/14-test-tiers.md#step-2-pilots
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { appUp } from "../app/index.js";
import { isLocalProvider } from "../config/index.js";
import {
  buildAndSignLocalImage,
  loadImageLock,
  pruneStaleImageTags,
} from "../images/index.js";
import {
  platformDestroy,
  platformStop,
  platformUp,
} from "../platform/index.js";
import { environmentStatePath } from "../runtime/index.js";
import { syncLocalSecrets } from "../security/index.js";
import { localDown, localUp } from "./local.js";
import {
  builtImage,
  fakeRepository,
  fakeRunner,
  imageLock,
  localLockPath,
  localPublicKeyPath,
  noDaemon,
  signedLocalLock,
} from "./local-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("../app/index.js");
vi.mock("../config/index.js");
vi.mock("../images/index.js");
vi.mock("../platform/index.js");
vi.mock("../security/index.js");
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  environmentStatePath: vi.fn(),
}));

const repository = fakeRepository();
const managed = fakeRepository({ provider: "managed" });

beforeEach(() => {
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(dirname).mockImplementation((path) =>
    path.slice(0, path.lastIndexOf("/")),
  );
  vi.mocked(environmentStatePath).mockImplementation(
    (root, environment, file) =>
      `${root}/.kore/state/environments/${environment}/${file}`,
  );
  vi.mocked(loadImageLock).mockResolvedValue(imageLock("reference"));
  vi.mocked(syncLocalSecrets).mockResolvedValue(1);
  vi.mocked(buildAndSignLocalImage).mockImplementation(
    async (_repository, _runner, application) => builtImage(application),
  );
});

test("local up starts the platform, then the secrets, then reconciles each locked application in name order", async () => {
  const { runner } = fakeRunner();
  const calls: string[] = [];
  vi.mocked(loadImageLock).mockResolvedValue(imageLock("reference", "catalog"));
  vi.mocked(platformUp).mockImplementation(async () => {
    calls.push("platform");
  });
  vi.mocked(syncLocalSecrets).mockImplementation(async () => {
    calls.push("secrets");
    return 1;
  });
  vi.mocked(buildAndSignLocalImage).mockImplementation(
    async (_repository, _runner, application) => {
      calls.push(`build:${application}`);
      return builtImage(application);
    },
  );
  vi.mocked(appUp).mockImplementation(async (_repository, _runner, name) => {
    calls.push(`deploy:${name}`);
  });

  await localUp(repository, runner);

  expect(calls).toEqual([
    "platform",
    "secrets",
    "build:catalog",
    "deploy:catalog",
    "build:reference",
    "deploy:reference",
  ]);
});

test("local up builds each application from its lock entry and deploys the signed image with its public key", async () => {
  const { runner } = fakeRunner();

  await localUp(repository, runner);

  expect(vi.mocked(buildAndSignLocalImage).mock.calls).toEqual([
    [
      repository,
      runner,
      "reference",
      {
        image: "registry.kore.local:30500/reference",
        digest: `sha256:${"b".repeat(64)}`,
        signer: "local-kore-key",
      },
    ],
  ]);
  expect(vi.mocked(appUp).mock.calls).toEqual([
    [
      repository,
      runner,
      "reference",
      builtImage("reference").image,
      { publicKey: localPublicKeyPath() },
    ],
  ]);
});

test("local up prunes the tags earlier runs left after the platform is up and before it builds anything", async () => {
  const { runner } = fakeRunner();
  const calls: string[] = [];
  vi.mocked(platformUp).mockImplementation(async () => {
    calls.push("platform");
  });
  vi.mocked(pruneStaleImageTags).mockImplementation(async () => {
    calls.push("prune");
  });
  vi.mocked(buildAndSignLocalImage).mockImplementation(
    async (_repository, _runner, application) => {
      calls.push("build");
      return builtImage(application);
    },
  );

  await localUp(repository, runner);

  expect(calls).toEqual(["platform", "prune", "build"]);
  expect(vi.mocked(pruneStaleImageTags).mock.calls).toEqual([
    [repository, runner],
  ]);
});

test("local up goes on, and says so on stderr, when pruning stale tags fails on a command", async () => {
  const { runner } = fakeRunner();
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.mocked(pruneStaleImageTags).mockRejectedValue(noDaemon());

  await expect(localUp(repository, runner)).resolves.toBeUndefined();

  expect(stderr.mock.calls).toEqual([
    [
      "could not prune stale local image tags, continuing: docker image ls failed (1): no daemon\n",
    ],
  ]);
  expect(vi.mocked(buildAndSignLocalImage)).toHaveBeenCalledTimes(1);
});

test("local up stops at any other failure while pruning and builds nothing", async () => {
  const { runner } = fakeRunner();
  vi.mocked(pruneStaleImageTags).mockRejectedValue(new TypeError("a bug"));

  await expect(localUp(repository, runner)).rejects.toThrow("a bug");

  expect(buildAndSignLocalImage).not.toHaveBeenCalled();
  expect(appUp).not.toHaveBeenCalled();
});

test("local up discards a local lock left by a vanished signing key before it re-signs", async () => {
  const { runner } = fakeRunner();

  await localUp(repository, runner);

  expect(vi.mocked(rm).mock.calls).toEqual([
    [localLockPath(), { force: true }],
  ]);
  expect(vi.mocked(rm).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(buildAndSignLocalImage).mock.invocationCallOrder[0]!,
  );
});

test("local up records the signed lock after each build, authorising the local key alone", async () => {
  const { runner } = fakeRunner();

  await localUp(repository, runner);

  expect(vi.mocked(mkdir).mock.calls).toEqual([
    [`/repo/.kore/state/environments/local`, { recursive: true }],
  ]);
  expect(vi.mocked(writeFile).mock.calls).toEqual([
    [localLockPath(), signedLocalLock(), { mode: 0o600 }],
  ]);
});

test("both lifecycle commands refuse a managed environment before they read the lock or touch the platform", async () => {
  const { runner, run } = fakeRunner();
  vi.mocked(isLocalProvider).mockReturnValue(false);

  await expect(localUp(managed, runner)).rejects.toThrow(
    "local lifecycle commands only manage k3d environments; environment local is managed",
  );
  await expect(
    localDown(managed, runner, { prune: true, purgeData: false }),
  ).rejects.toThrow(/only manage k3d environments/);

  expect(loadImageLock).not.toHaveBeenCalled();
  expect(platformUp).not.toHaveBeenCalled();
  expect(platformStop).not.toHaveBeenCalled();
  expect(platformDestroy).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("local down without prune stops the cluster, keeps the signed digests and destroys nothing", async () => {
  const { runner } = fakeRunner();

  await localDown(repository, runner, { prune: false, purgeData: false });

  expect(vi.mocked(platformStop).mock.calls).toEqual([
    [repository, runner, {}, { force: false }],
  ]);
  expect(platformDestroy).not.toHaveBeenCalled();
  expect(rm).not.toHaveBeenCalled();
});

test("local down with prune destroys the cluster and keeps its data unless purge is asked", async () => {
  const { runner } = fakeRunner();

  await localDown(repository, runner, { prune: true, purgeData: false });

  expect(vi.mocked(platformDestroy).mock.calls).toEqual([
    [repository, runner, { yes: true, purgeData: false, force: false }],
  ]);
  expect(platformStop).not.toHaveBeenCalled();
});

test("local down with prune and purge data destroys the data along with the cluster", async () => {
  const { runner } = fakeRunner();

  await localDown(repository, runner, { prune: true, purgeData: true });

  expect(vi.mocked(platformDestroy).mock.calls).toEqual([
    [repository, runner, { yes: true, purgeData: true, force: false }],
  ]);
});

test("local down with prune forgets the digest and public key of the destroyed signing key before it destroys the cluster", async () => {
  const { runner } = fakeRunner();

  await localDown(repository, runner, { prune: true, purgeData: false });

  expect(vi.mocked(rm).mock.calls).toEqual([
    [localLockPath(), { force: true }],
    [localPublicKeyPath(), { force: true }],
  ]);
  expect(
    vi.mocked(platformDestroy).mock.invocationCallOrder[0],
  ).toBeGreaterThan(vi.mocked(rm).mock.invocationCallOrder[1]!);
});

test("local down --force reaches the registry forward stop, with or without prune", async () => {
  const { runner } = fakeRunner();

  await localDown(repository, runner, {
    prune: false,
    purgeData: false,
    force: true,
  });
  await localDown(repository, runner, {
    prune: true,
    purgeData: false,
    force: true,
  });

  expect(vi.mocked(platformStop).mock.calls).toEqual([
    [repository, runner, {}, { force: true }],
  ]);
  expect(vi.mocked(platformDestroy).mock.calls).toEqual([
    [repository, runner, { yes: true, purgeData: false, force: true }],
  ]);
});

test("purging retained data without prune is refused before anything is touched", async () => {
  const { runner } = fakeRunner();

  await expect(
    localDown(repository, runner, { prune: false, purgeData: true }),
  ).rejects.toThrow(/--purge-data requires --prune/);

  expect(platformStop).not.toHaveBeenCalled();
  expect(platformDestroy).not.toHaveBeenCalled();
  expect(rm).not.toHaveBeenCalled();
});
