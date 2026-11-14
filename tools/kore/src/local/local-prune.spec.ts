// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md
import { beforeEach, expect, test, vi } from "vitest";
import { isLocalProvider } from "../config/index.js";
import {
  buildAndSignLocalImage,
  loadImageLock,
  pruneRegistryTagsInCluster,
  pruneStaleImageTags,
  RegistryPruneError,
} from "../images/index.js";
import { platformUp } from "../platform/index.js";
import { syncLocalSecrets } from "../security/index.js";
import { localUp } from "./local.js";
import {
  builtImage,
  fakeRepository,
  fakeRunner,
  imageLock,
} from "./local-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
vi.mock("../app/index.js");
vi.mock("../config/index.js");
vi.mock("../images/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../images/index.js")>();
  // Functions are faked; the error class stays real so `instanceof` works.
  return {
    ...Object.fromEntries(Object.keys(actual).map((name) => [name, vi.fn()])),
    RegistryPruneError: actual.RegistryPruneError,
  };
});
vi.mock("../platform/index.js");
vi.mock("../security/index.js");
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime/index.js")>()),
  environmentStatePath: vi.fn(() => "/state/local-images.lock.json"),
}));

const repository = fakeRepository();

beforeEach(() => {
  vi.mocked(isLocalProvider).mockReturnValue(true);
  vi.mocked(loadImageLock).mockResolvedValue(imageLock("reference"));
  vi.mocked(syncLocalSecrets).mockResolvedValue(1);
  vi.mocked(buildAndSignLocalImage).mockImplementation(
    async (_repository, _runner, application) => builtImage(application),
  );
});

test("local up prunes the registry after the node and host tags and before it builds anything", async () => {
  const { runner } = fakeRunner();
  const calls: string[] = [];
  vi.mocked(platformUp).mockImplementation(async () => {
    calls.push("platform");
  });
  vi.mocked(pruneStaleImageTags).mockImplementation(async () => {
    calls.push("tags");
  });
  vi.mocked(pruneRegistryTagsInCluster).mockImplementation(async () => {
    calls.push("registry");
  });
  vi.mocked(buildAndSignLocalImage).mockImplementation(
    async (_repository, _runner, application) => {
      calls.push("build");
      return builtImage(application);
    },
  );

  await localUp(repository, runner);

  expect(calls).toEqual(["platform", "tags", "registry", "build"]);
});

test("local up goes on, and says so on stderr, when the registry refuses to prune", async () => {
  const { runner } = fakeRunner();
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  vi.mocked(pruneRegistryTagsInCluster).mockRejectedValue(
    new RegistryPruneError("registry answered 405"),
  );

  await expect(localUp(repository, runner)).resolves.toBeUndefined();

  expect(stderr.mock.calls).toEqual([
    ["could not prune registry tags, continuing: registry answered 405\n"],
  ]);
  expect(vi.mocked(buildAndSignLocalImage)).toHaveBeenCalledTimes(1);
});

test("local up stops at a bug while pruning the registry and builds nothing", async () => {
  const { runner } = fakeRunner();
  vi.mocked(pruneRegistryTagsInCluster).mockRejectedValue(new TypeError("bug"));

  await expect(localUp(repository, runner)).rejects.toThrow("bug");

  expect(buildAndSignLocalImage).not.toHaveBeenCalled();
});
