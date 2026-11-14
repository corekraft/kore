import { beforeEach, describe, expect, it, vi } from "vitest";
import { featureEnabled, type Repository } from "../config/index.js";
import {
  pruneRegistryTags,
  type RegistryAdmin,
  type RegistryPruneDependencies,
} from "./registry-prune.js";

// Docs: docs/decisions/0094-worktrees-sharing-a-cluster-share-its-locks-tags-and-forward.md

vi.mock("../config/index.js");

const repository = { environment: { features: {} } } as Repository;
const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;
const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;
const oldRun = "kore-local-aaaaaaaaaaaa";
const youngRun = "kore-local-bbbbbbbbbbbb";

interface Registry {
  tags: Record<string, { digest: string; age: number }>;
  pods?: string[];
  locked?: string[];
  lease?: boolean;
  failPods?: boolean;
}

/** A registry holding one repository, and the dependencies around it. */
function setup(registry: Registry) {
  const remove = vi.fn<RegistryAdmin["remove"]>().mockResolvedValue();
  const collectGarbage = vi.fn<() => Promise<void>>().mockResolvedValue();
  const admin: RegistryAdmin = {
    repositories: async () => ["reference"],
    tags: async () => Object.keys(registry.tags),
    digest: async (_repo, tag) => registry.tags[tag]!.digest,
    created: async (_repo, tag) => now - registry.tags[tag]!.age * DAY,
    remove,
  };
  const dependencies: RegistryPruneDependencies = {
    holdsLease: async () => registry.lease ?? true,
    podImages: async () => {
      if (registry.failPods === true) {
        throw new Error("pods unavailable");
      }
      return new Set(registry.pods ?? []);
    },
    lockedDigests: async () => new Set(registry.locked ?? []),
    admin,
    collectGarbage,
    now: () => now,
    keepWindowMs: 7 * DAY,
  };
  return { dependencies, remove, collectGarbage };
}

beforeEach(() => {
  vi.mocked(featureEnabled).mockReturnValue(true);
});

describe("registry tag pruning", () => {
  it("deletes only the old per-run tag's digest, then collects garbage once", async () => {
    const { dependencies, remove, collectGarbage } = setup({
      tags: {
        [oldRun]: { digest: digest("a"), age: 30 },
        [youngRun]: { digest: digest("b"), age: 1 },
        "kore-src-0123456789abcdef": { digest: digest("c"), age: 30 },
        "kore-local": { digest: digest("d"), age: 30 },
      },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove.mock.calls).toEqual([["reference", digest("a")]]);
    expect(collectGarbage).toHaveBeenCalledOnce();
  });

  it("never deletes a digest a pod uses", async () => {
    const { dependencies, remove, collectGarbage } = setup({
      tags: { [oldRun]: { digest: digest("a"), age: 30 } },
      pods: [`10.96.0.50:5000/reference@${digest("a")}`],
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
    expect(collectGarbage).not.toHaveBeenCalled();
  });

  it("never deletes a digest a pod names by its per-run tag", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("a"), age: 30 } },
      pods: [`10.96.0.50:5000/reference:${oldRun}`],
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
  });

  it("never deletes a digest a lock file references", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("a"), age: 30 } },
      locked: [digest("a")],
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
  });

  it("never deletes a digest a source tag also names, since a delete removes every tag on it", async () => {
    const { dependencies, remove } = setup({
      tags: {
        [oldRun]: { digest: digest("a"), age: 30 },
        "kore-src-0123456789abcdef": { digest: digest("a"), age: 30 },
      },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("registry tag pruning refusals", () => {
  it("deletes nothing without the host lease", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("a"), age: 30 } },
      lease: false,
    });
    await expect(pruneRegistryTags(repository, dependencies)).rejects.toThrow(
      "refusing to prune registry tags without the host lease",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes nothing when the pods cannot be listed", async () => {
    const { dependencies, remove, collectGarbage } = setup({
      tags: { [oldRun]: { digest: digest("a"), age: 30 } },
      failPods: true,
    });
    await expect(pruneRegistryTags(repository, dependencies)).rejects.toThrow(
      "pods unavailable",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(collectGarbage).not.toHaveBeenCalled();
  });

  it("does nothing at all while the flag is off", async () => {
    vi.mocked(featureEnabled).mockReturnValue(false);
    const { dependencies, remove, collectGarbage } = setup({
      tags: { [oldRun]: { digest: digest("a"), age: 30 } },
      lease: false,
      failPods: true,
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
    expect(collectGarbage).not.toHaveBeenCalled();
  });
});
