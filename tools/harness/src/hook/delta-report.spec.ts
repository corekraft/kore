// Delta: what changed between a session's turns, as UserPromptSubmit context.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

import { describe, expect, it } from "vitest";
import { update } from "./delta.js";
import {
  entry,
  fakeDeltaDeps as fakeDeps,
  planText,
} from "../testing/index.js";

describe("delta update", () => {
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
});

describe("delta locks", () => {
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

describe("delta journal and size", () => {
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
