import { describe, expect, it, vi } from "vitest";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { asFake } from "./images-support.js";
import { readRevertRecord } from "./lock-digests.js";

// Docs: docs/decisions/0153-rollback-goes-through-the-release-owner-and-host-maintenance-never-drains.md

const repository = asFake<Repository>({ root: "/repo" });
const digest = (letter: string): string => `sha256:${letter.repeat(64)}`;

/** A release lock naming one digest per service. */
const lock = (digests: Record<string, string>): string =>
  JSON.stringify({
    version: 1,
    authorizedSigners: ["local-kore-key"],
    entries: Object.fromEntries(
      Object.entries(digests).map(([name, value]) => [
        name,
        {
          image: `registry.kore.local:30500/${name}`,
          digest: value,
          signer: "local-kore-key",
        },
      ]),
    ),
  });

interface History {
  /** Whether the checkout is shallow. */
  shallow?: boolean;
  /** Commits that touch the lock, newest first. */
  commits: string[];
  /** The lock's contents at each commit. */
  locks: Record<string, string>;
  /** Commits whose lock cannot be read. */
  unreadable?: string[];
  /** Receives every git call's arguments, in order. */
  calls?: string[][];
}

/** A git runner over a fixed history of the release lock. */
function gitOver(history: History): Runner {
  const run = vi.fn(async (command: string, args: readonly string[]) => {
    history.calls?.push([...args]);
    if (command !== "git") {
      throw new Error(`unexpected command ${command}`);
    }
    if (args.includes("--is-shallow-repository")) {
      return { stdout: `${history.shallow === true}\n`, stderr: "", code: 0 };
    }
    if (args.includes("log")) {
      return {
        stdout: history.commits.map((sha) => `${sha}\n`).join(""),
        stderr: "",
        code: 0,
      };
    }
    const sha = args.at(-1)!.split(":")[0]!;
    if (history.unreadable?.includes(sha) === true) {
      throw new Error(`fatal: path missing at ${sha}`);
    }
    return { stdout: history.locks[sha]!, stderr: "", code: 0 };
  });
  return asFake<Runner>({ run });
}

describe("reading the release lock's history for a revert", () => {
  it("lists each service's digests newest first, from the commits that touched the lock", async () => {
    const record = await readRevertRecord(
      repository,
      gitOver({
        commits: ["c3", "c2", "c1"],
        locks: {
          c3: lock({ reference: digest("b") }),
          c2: lock({ reference: digest("a") }),
          c1: lock({ reference: digest("a") }),
        },
      }),
    );
    expect(record.services.get("reference")).toEqual([
      digest("b"),
      digest("a"),
      digest("a"),
    ]);
  });

  it("treats every digest the history names as soaking until activation is recorded", async () => {
    const record = await readRevertRecord(
      repository,
      gitOver({
        commits: ["c2", "c1"],
        locks: {
          c2: lock({ reference: digest("b") }),
          c1: lock({ reference: digest("a"), frontend: digest("c") }),
        },
      }),
    );
    expect(record.soaking).toEqual(
      new Set([digest("a"), digest("b"), digest("c")]),
    );
  });

  it("reads an empty history when no commit has touched the lock", async () => {
    const record = await readRevertRecord(
      repository,
      gitOver({ commits: [], locks: {} }),
    );
    expect(record.services.size).toBe(0);
    expect(record.soaking.size).toBe(0);
  });
});

describe("reading the release lock's history refuses what it cannot read whole", () => {
  it("refuses a shallow checkout, whose history is incomplete, and reads no lock", async () => {
    const calls: string[][] = [];
    const runner = gitOver({
      shallow: true,
      commits: ["c1"],
      locks: { c1: lock({ reference: digest("a") }) },
      calls,
    });
    await expect(readRevertRecord(repository, runner)).rejects.toThrow(
      "shallow",
    );
    expect(calls).toEqual([
      ["-C", "/repo", "rev-parse", "--is-shallow-repository"],
    ]);
  });

  it("refuses when a lock in the history cannot be read, so nothing is pruned on a guess", async () => {
    await expect(
      readRevertRecord(
        repository,
        gitOver({
          commits: ["c2", "c1"],
          locks: { c2: lock({ reference: digest("b") }) },
          unreadable: ["c1"],
        }),
      ),
    ).rejects.toThrow("path missing at c1");
  });

  it("refuses a committed file that has no entries, since it is not a release lock", async () => {
    await expect(
      readRevertRecord(
        repository,
        gitOver({ commits: ["c1"], locks: { c1: '{"version": 1}' } }),
      ),
    ).rejects.toThrow("has no entries object");
  });

  it("refuses a lock whose entry names no sha256 digest", async () => {
    await expect(
      readRevertRecord(
        repository,
        gitOver({
          commits: ["c1"],
          locks: { c1: lock({ reference: "latest" }) },
        }),
      ),
    ).rejects.toThrow("no sha256 digest");
  });
});
