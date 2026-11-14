// Delta: what changed between a session's turns, as UserPromptSubmit context.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

import { describe, expect, it } from "vitest";
import { describeChanges, snapshot, update } from "./delta.js";
import { entry, fakeDeltaDeps as fakeDeps } from "../testing/index.js";

describe("delta fail-open and pruning", () => {
  it("prints nothing instead of throwing when git or the filesystem fails", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    expect(
      await update("s1", {
        ...deps,
        main: () => Promise.reject(new Error("git exploded")),
      }),
    ).toBe("");
  });

  const DAY = 24 * 60 * 60 * 1000;

  it("prunes other sessions' snapshots older than 14 days, never its own", async () => {
    const removed: string[] = [];
    const now = 100 * DAY;
    const { deps } = fakeDeps({
      now: () => now,
      listSnapshots: () =>
        Promise.resolve([
          { id: "old", mtimeMs: now - 15 * DAY },
          { id: "recent", mtimeMs: now - 13 * DAY },
          { id: "s1", mtimeMs: now - 30 * DAY },
        ]),
      removeSnapshot: (id) => {
        removed.push(id);
        return Promise.resolve();
      },
    });
    await update("s1", deps);
    expect(removed).toEqual(["old"]);
  });

  it("keeps the delta when pruning fails", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    const out = await update("s1", {
      ...deps,
      branch: () => Promise.resolve("feat/y"),
      listSnapshots: () => Promise.reject(new Error("readdir failed")),
    });
    expect(out).toMatch(/branch changed/);
    const noisy = await update("s1", {
      ...deps,
      branch: () => Promise.resolve("feat/z"),
      listSnapshots: () => Promise.resolve([{ id: "old", mtimeMs: -99 * DAY }]),
      removeSnapshot: () => Promise.reject(new Error("unlink failed")),
    });
    expect(noisy).toMatch(/feat\/z/);
  });
});

describe("delta snapshot", () => {
  it("records head, branch, main, plan items, locks, and the last journal operation", async () => {
    const { deps } = fakeDeps({
      listLocks: () => Promise.resolve(["local.lock"]),
      readJournals: () =>
        Promise.resolve({
          local: [
            entry("a", "start", { command: "local up" }),
            entry("a", "end", { outcome: "ok" }),
          ],
        }),
    });
    const snap = await snapshot(deps);
    expect(snap.head).toBe("aaa1111");
    expect(snap.branch).toBe("feat/x");
    expect(snap.locks).toEqual(["local.lock"]);
    expect(snap.journal["local"]).toEqual({
      op: "a",
      command: "local up",
      outcome: "ok",
    });
    expect(snap.plans["6-plan.md"]).toEqual({ "Build it.": false });
  });

  it("describes identical snapshots as an empty string", async () => {
    const { deps } = fakeDeps();
    const snap = await snapshot(deps);
    expect(describeChanges(snap, snap, () => [])).toBe("");
  });
});
