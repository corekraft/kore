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
const otherOldRun = "kore-local-cccccccccccc";

interface Registry {
  tags: Record<string, { digest: string; age: number }>;
  pods?: string[];
  locked?: string[];
  lease?: boolean;
  failPods?: boolean;
  /** Each service's digests from the release lock's history, newest first. */
  history?: Record<string, string[]>;
  /** Digests whose soak has not ended. */
  soaking?: string[];
  failHistory?: boolean;
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
    revert: async () => {
      if (registry.failHistory === true) {
        throw new Error("release lock history unreadable");
      }
      return {
        services: new Map(Object.entries(registry.history ?? {})),
        soaking: new Set(registry.soaking ?? []),
      };
    },
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

describe("registry tag pruning keeps the digests a revert needs", () => {
  it("keeps a service's current digest", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("a"), age: 30 } },
      history: { reference: [digest("a")] },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes an old per-run digest that is not among a service's last three distinct digests", async () => {
    const { dependencies, remove, collectGarbage } = setup({
      tags: { [oldRun]: { digest: digest("d"), age: 30 } },
      history: { reference: [digest("a"), digest("b"), digest("c")] },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove.mock.calls).toEqual([["reference", digest("d")]]);
    expect(collectGarbage).toHaveBeenCalledOnce();
  });

  it("keeps the third distinct digest of a service", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("c"), age: 30 } },
      history: { reference: [digest("a"), digest("b"), digest("c")] },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
  });

  it("counts distinct digests, so re-bumping one image does not use up the three", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("c"), age: 30 } },
      history: {
        reference: [
          digest("a"),
          digest("a"),
          digest("a"),
          digest("b"),
          digest("c"),
        ],
      },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes the fourth distinct digest of a service, once the three newer ones are kept", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("d"), age: 30 } },
      history: {
        reference: [
          digest("a"),
          digest("a"),
          digest("b"),
          digest("c"),
          digest("d"),
        ],
      },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove.mock.calls).toEqual([["reference", digest("d")]]);
  });
});

describe("registry tag pruning keeps a soaking digest and a kept digest's attachments", () => {
  it("keeps a digest whose soak has not ended, even beyond the last three", async () => {
    const { dependencies, remove } = setup({
      tags: { [oldRun]: { digest: digest("e"), age: 30 } },
      history: {
        reference: [digest("a"), digest("b"), digest("c"), digest("e")],
      },
      soaking: [digest("e")],
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps a kept digest's signature and attestation, and collects garbage once for the digest it deletes", async () => {
    const kept = "c".repeat(64);
    const { dependencies, remove, collectGarbage } = setup({
      tags: {
        [oldRun]: { digest: digest("c"), age: 30 },
        [otherOldRun]: { digest: digest("d"), age: 30 },
        [`sha256-${kept}.sig`]: { digest: digest("s"), age: 30 },
        [`sha256-${kept}.att`]: { digest: digest("t"), age: 30 },
      },
      history: { reference: [digest("a"), digest("b"), digest("c")] },
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove.mock.calls).toEqual([["reference", digest("d")]]);
    expect(collectGarbage).toHaveBeenCalledOnce();
  });

  it("deletes nothing and collects no garbage when the release lock history cannot be read", async () => {
    const { dependencies, remove, collectGarbage } = setup({
      tags: { [oldRun]: { digest: digest("d"), age: 30 } },
      failHistory: true,
    });
    await expect(pruneRegistryTags(repository, dependencies)).rejects.toThrow(
      "release lock history unreadable",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(collectGarbage).not.toHaveBeenCalled();
  });
});

describe("registry tag pruning's revert keep has its own flag", () => {
  it("reads no lock history, and prunes as before, while the revert-keep flag is off", async () => {
    vi.mocked(featureEnabled).mockImplementation(
      (_environment, flag) => flag === "registry-tag-pruning",
    );
    const { dependencies, remove, collectGarbage } = setup({
      tags: { [oldRun]: { digest: digest("d"), age: 30 } },
      failHistory: true,
    });
    await pruneRegistryTags(repository, dependencies);
    expect(remove.mock.calls).toEqual([["reference", digest("d")]]);
    expect(collectGarbage).toHaveBeenCalledOnce();
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
