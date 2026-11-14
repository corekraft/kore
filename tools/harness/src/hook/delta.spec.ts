// Delta: what changed between a session's turns, as UserPromptSubmit context.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

import { beforeEach, describe, expect, it, vi } from "vitest";
import { activePlans, listItems } from "../plan/index.js";
import { describeChanges, snapshot, update } from "./delta.js";
import { entry, fakeDeps, planText } from "./delta-support.js";

// The plan parser is another domain's unit: automocked here, with fakes that
// read a plan's list items and its active plans from the markdown itself.
vi.mock("../plan/index.js", () => ({
  activePlans: vi.fn(),
  listItems: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(activePlans).mockImplementation((plans) => Object.keys(plans));
  vi.mocked(listItems).mockImplementation((markdown) =>
    markdown
      .split("\n")
      .filter((line) => line.startsWith("- ["))
      .map((text) => ({ heading: "Step 1: Work", text })),
  );
});

describe("delta update, first prompt and unchanged state", () => {
  it("writes a snapshot and prints nothing on the first prompt of a session", async () => {
    const { deps, store } = fakeDeps();
    expect(await update("s1", deps)).toBe("");
    expect(store.get("s1")?.main).toBe("bbb2222");
  });

  it("prints nothing when nothing changed", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    expect(await update("s1", deps)).toBe("");
  });

  it("keeps a separate snapshot per session", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    const moved = {
      ...deps,
      main: () => Promise.resolve("ccc3333"),
      commitsBetween: () => Promise.resolve(["feat: x"]),
    };
    expect(await update("s2", moved)).toBe("");
    expect(await update("s1", moved)).toMatch(/main/);
  });

  it("does not ask for commits between mains when main did not move", async () => {
    const { deps } = fakeDeps();
    const commitsBetween = vi.fn(() => Promise.resolve(["never"]));
    await update("s1", { ...deps, commitsBetween });
    await update("s1", {
      ...deps,
      commitsBetween,
      branch: () => Promise.resolve("b"),
    });
    expect(commitsBetween).not.toHaveBeenCalled();
  });
});

describe("delta update, what changed", () => {
  it("reports new commits on main with their subjects", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    const calls: string[][] = [];
    const out = await update("s1", {
      ...deps,
      main: () => Promise.resolve("ccc3333"),
      commitsBetween: (from, to) => {
        calls.push([from, to]);
        return Promise.resolve(["feat: add journal", "fix: typo"]);
      },
    });
    expect(calls).toEqual([["bbb2222", "ccc3333"]]);
    expect(out).toMatch(/main advanced 2 commits/);
    expect(out).toMatch(/feat: add journal/);
  });

  it("reports a branch switch", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    expect(
      await update("s1", { ...deps, branch: () => Promise.resolve("feat/y") }),
    ).toMatch(/branch changed from feat\/x to feat\/y/);
  });

  it("reports ticked and added plan items, never unticked ones", async () => {
    const { deps } = fakeDeps({
      readPlans: () =>
        Promise.resolve({
          "6-plan.md": planText("- [ ] Build it.", "- [ ] Ship it."),
        }),
    });
    await update("s1", deps);
    const out = await update("s1", {
      ...deps,
      readPlans: () =>
        Promise.resolve({
          "6-plan.md": planText(
            "- [x] Build it.",
            "- [ ] Ship it.",
            "- [ ] Document it.",
          ),
        }),
    });
    expect(out).toMatch(/6-plan\.md/);
    expect(out).toMatch(/ticked: Build it\./);
    expect(out).toMatch(/added: Document it\./);
    expect(out).not.toMatch(/Ship it/);
  });

  it("reports locks taken and released", async () => {
    const { deps } = fakeDeps({
      listLocks: () => Promise.resolve(["local.lock"]),
    });
    await update("s1", deps);
    const out = await update("s1", {
      ...deps,
      listLocks: () => Promise.resolve(["staging.lock"]),
    });
    expect(out).toMatch(/lock taken: staging\.lock/);
    expect(out).toMatch(/lock released: local\.lock/);
  });
});

describe("delta update, journal operations and size", () => {
  it("reports journal operations started, finished, and failed", async () => {
    const started = { local: [entry("a", "start", { command: "local up" })] };
    const { deps } = fakeDeps({ readJournals: () => Promise.resolve(started) });
    expect(await update("s1", deps)).toBe("");

    const finished = {
      local: [...started.local, entry("a", "end", { outcome: "ok" })],
    };
    expect(
      await update("s1", {
        ...deps,
        readJournals: () => Promise.resolve(finished),
      }),
    ).toMatch(/local: `local up` finished ok/);

    const next = {
      local: [
        ...finished.local,
        entry("b", "start", { command: "local down" }),
      ],
    };
    expect(
      await update("s1", {
        ...deps,
        readJournals: () => Promise.resolve(next),
      }),
    ).toMatch(/local: `local down` started/);

    const failed = {
      local: [
        ...next.local,
        entry("b", "end", { outcome: "failed", error: "boom" }),
      ],
    };
    expect(
      await update("s1", {
        ...deps,
        readJournals: () => Promise.resolve(failed),
      }),
    ).toMatch(/local: `local down` failed: boom/);
  });

  it("reports a new journal in a known session as a started operation", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    expect(
      await update("s1", {
        ...deps,
        readJournals: () =>
          Promise.resolve({
            local: [entry("a", "start", { command: "local up" })],
          }),
      }),
    ).toMatch(/local: `local up` started/);
  });

  it("caps the output at 600 characters", async () => {
    const { deps } = fakeDeps();
    await update("s1", deps);
    const many = Array.from(
      { length: 80 },
      (_, i) => `- [ ] Item number ${i} with some text.`,
    );
    const out = await update("s1", {
      ...deps,
      readPlans: () => Promise.resolve({ "6-plan.md": planText(...many) }),
      listLocks: () =>
        Promise.resolve(Array.from({ length: 40 }, (_, i) => `env${i}.lock`)),
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(600);
  });
});

describe("delta update, fail-open and pruning", () => {
  it("prints nothing instead of throwing when git fails", async () => {
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
