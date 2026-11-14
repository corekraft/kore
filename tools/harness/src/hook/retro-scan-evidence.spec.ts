// The guard-block evidence the scan reports per rule: where each block is,
// capped per rule, beside the total count. Unit spec: parsing and session
// analysis are mocked, so only the scan's tally runs.

import { describe, expect, it, vi } from "vitest";

const sessions = vi.hoisted(() => new Map<string, unknown>());

vi.mock("./retro-transcript.js", () => ({
  parseTranscript: (id: string) => ({ id, events: [], skipped: 0 }),
  timestamps: () => ({
    first: "2026-11-03T00:00:00.000Z",
    last: "2026-11-03T00:01:00.000Z",
  }),
  summarizeError: (text: string) => text,
}));

vi.mock("./retro-session.js", () => ({
  SessionAnalysis: class {
    readonly guards: Record<string, { blocks: number; warnings: number }> = {};
    readonly failures: { tool: string; error: string }[] = [];
    readonly skills = new Set<string>();
    readonly slashCommands: string[] = [];
    readonly phrases: { phrase: string; line: number }[] = [];
    readonly warnings: { rule: string; toolUseId: string | undefined }[] = [];
    readonly guardBlocks: { rule: string; line: number; excerpt: string }[] =
      [];

    constructor(session: { id: string }) {
      Object.assign(this, sessions.get(session.id));
    }

    outcome(): string {
      return "heeded";
    }
  },
}));

const { scan } = await import("./retro-scan.js");

const block = (rule: string, line: number) => ({
  rule,
  line,
  excerpt: `[guard:${rule}] line ${line}`,
});

const blocked = (rule: string, count: number, line = 0) =>
  Array.from({ length: count }, (_, index) => block(rule, line + index + 1));

describe("retro scan guard-block evidence", () => {
  it("reports each blocked rule's session, line and excerpt, and no entry for a warning-only rule", () => {
    sessions.set("a", {
      guards: {
        "role-worktree": { blocks: 1, warnings: 0 },
        "unquoted-glob": { blocks: 1, warnings: 1 },
      },
      guardBlocks: [block("role-worktree", 4), block("unquoted-glob", 9)],
    });
    expect(
      scan([{ id: "a", text: "" }], { evidence: true }).guardEvidence,
    ).toEqual({
      "role-worktree": [
        { session: "a", line: 4, excerpt: "[guard:role-worktree] line 4" },
      ],
      "unquoted-glob": [
        { session: "a", line: 9, excerpt: "[guard:unquoted-glob] line 9" },
      ],
    });
  });

  it("keeps 20 entries per rule in session order, while the guard count still reports every block", () => {
    sessions.set("a", {
      guards: { "role-worktree": { blocks: 15, warnings: 0 } },
      guardBlocks: blocked("role-worktree", 15),
    });
    sessions.set("b", {
      guards: { "role-worktree": { blocks: 10, warnings: 0 } },
      guardBlocks: blocked("role-worktree", 10),
    });
    const report = scan(
      [
        { id: "a", text: "" },
        { id: "b", text: "" },
      ],
      { evidence: true },
    );
    const evidence = report.guardEvidence?.["role-worktree"] ?? [];
    expect(evidence).toHaveLength(20);
    expect(evidence[0]).toEqual({
      session: "a",
      line: 1,
      excerpt: "[guard:role-worktree] line 1",
    });
    expect(evidence[19]).toEqual({
      session: "b",
      line: 5,
      excerpt: "[guard:role-worktree] line 5",
    });
    expect(report.guards["role-worktree"]).toEqual({ blocks: 25, warnings: 0 });
  });

  it("leaves guardEvidence out of the default report, so the default output does not change", () => {
    sessions.set("a", {
      guards: { "role-worktree": { blocks: 1, warnings: 0 } },
      guardBlocks: [block("role-worktree", 4)],
    });
    const report = scan([{ id: "a", text: "" }]);
    expect(report).not.toHaveProperty("guardEvidence");
    expect(Object.keys(report)).toEqual([
      "sessions",
      "skippedLines",
      "guards",
      "failures",
      "skills",
      "corrections",
      "rules",
    ]);
  });
});
