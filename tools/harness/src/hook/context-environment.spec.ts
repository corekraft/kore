// The brief's environment lines, from the operation journals.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { describe, expect, it } from "vitest";
import { restore } from "./context.js";
import { deps } from "./context-support.js";

describe("context environment lines", () => {
  const entry = (op: string, kind: string, extra = {}) => ({
    ts: "2026-11-07T10:00:00.000Z",
    op,
    kind,
    ...extra,
  });
  const withJournals = (journals: Record<string, object[]>) =>
    deps({ readJournals: () => Promise.resolve(journals) });

  it("brief says nothing about environments that have no journal", async () => {
    expect(await restore({ source: "startup" }, withJournals({}))).toBe("");
    expect(
      await restore({ source: "startup" }, withJournals({ local: [] })),
    ).toBe("");
  });

  it("brief reports a finished operation with its outcome and date", async () => {
    const journals = {
      local: [
        entry("a", "start", { command: "local up" }),
        entry("a", "exec", { command: "helm" }),
        entry("a", "end", { outcome: "ok", ms: 5 }),
      ],
    };
    expect(await restore({ source: "startup" }, withJournals(journals))).toBe(
      "Environment local: last operation `local up` ok on 2026-11-07.",
    );
  });

  it("brief reports a failed operation with its error", async () => {
    const journals = {
      local: [
        entry("a", "start", { command: "local up" }),
        entry("a", "end", { outcome: "failed", error: "helm timed out" }),
      ],
    };
    expect(
      await restore({ source: "startup" }, withJournals(journals)),
    ).toMatch(
      /^Environment local: last operation `local up` failed on 2026-11-07: helm timed out\.$/,
    );
  });
});

describe("context environment lines, interrupted and ordered", () => {
  const entry = (op: string, kind: string, extra = {}) => ({
    ts: "2026-11-07T10:00:00.000Z",
    op,
    kind,
    ...extra,
  });
  const withJournals = (journals: Record<string, object[]>) =>
    deps({ readJournals: () => Promise.resolve(journals) });

  it("brief flags an interrupted operation and judges only the latest one", async () => {
    const journals = {
      local: [
        entry("a", "start", { command: "local down" }),
        entry("a", "end", { outcome: "failed", error: "old" }),
        entry("b", "start", { command: "local up" }),
        entry("b", "exec", { command: "helm" }),
      ],
    };
    const context = await restore(
      { source: "startup" },
      withJournals(journals),
    );
    expect(context).toBe(
      "Environment local: last operation `local up` was interrupted (started 2026-11-07, no end recorded).",
    );
    expect(context).not.toMatch(/old/);
  });

  it("brief lists environments in name order, one line each", async () => {
    const done = [
      entry("a", "start", { command: "x" }),
      entry("a", "end", { outcome: "ok" }),
    ];
    const lines = (
      await restore(
        { source: "startup" },
        withJournals({ staging: done, local: done }),
      )
    ).split("\n");
    expect(lines.map((l) => l.split(":")[0])).toEqual([
      "Environment local",
      "Environment staging",
    ]);
  });
});
