// The retrospective scan as a unit: the `Last retrospective:` marker and the
// report `scan` builds, with transcripts, session analysis and locations mocked.
// Real transcripts: integration/hook/retro-scan*.spec.ts.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { beforeEach, describe, expect, it, vi } from "vitest";
import { lastRetrospective, scan, windowStart } from "./retro-scan.js";
import { add, at, warning, wireSessions } from "./retro-scan-support.js";

const locations = vi.hoisted(() => ({ add: vi.fn(), sorted: vi.fn() }));

vi.mock("./retro-transcript.js", () => ({
  parseTranscript: vi.fn(),
  timestamps: vi.fn(),
}));
vi.mock("./retro-session.js", () => ({ SessionAnalysis: vi.fn() }));
vi.mock("./retro-locations.js", () => ({
  RuleLocations: vi.fn(function () {
    return locations;
  }),
}));

const FORM =
  "write a date (YYYY-MM-DD) or a UTC timestamp with date -u +%Y-%m-%dT%H:%M:%SZ";

// ----- the marker -----------------------------------------------------------

describe("lastRetrospective: which marker wins", () => {
  it("picks the later timestamp on one day, and a timestamp over a bare date that day", () => {
    const one =
      "Last retrospective: 2026-11-12T18:00:00Z\nLast retrospective: 2026-11-12T10:00:00Z\n";
    expect(lastRetrospective({ "3.md": one })).toBe("2026-11-12T18:00:00Z");
    expect(
      lastRetrospective({
        "3.md": "Last retrospective: 2026-11-12\n",
        "4.md": "Last retrospective: 2026-11-13T00:00:00Z\n",
      }),
    ).toBe("2026-11-13T00:00:00Z");
  });

  it("reads the marker section `retro record` keeps, over the dated lines above it", () => {
    expect(
      lastRetrospective({
        "3.md":
          "Last retrospective: 2026-11-12\n\n## Retrospective marker\n\nLast retrospective: 2026-11-14T09:30:00Z\n",
      }),
    ).toBe("2026-11-14T09:30:00Z");
  });

  it("ranks a bare date above a timestamp from an earlier day", () => {
    expect(
      lastRetrospective({
        "3.md": "Last retrospective: 2026-11-12\n",
        "4.md": "Last retrospective: 2026-11-10T00:00:00Z\n",
      }),
    ).toBe("2026-11-12");
  });

  it.each([
    "2026-11-12 18:00:00Z",
    "2026-11-12T18:00:00.000Z",
    "2026-11-12T18:00:00+00:00",
    "2026-11-12T18:00Z",
    "2026-11-12T25:00:00Z",
    "2026-13-45",
    "2026-02-30",
    "2026-02-30T00:00:00Z",
  ])("refuses %s with the plan line and the form to write", (value) => {
    const text = `# Plan\nLast retrospective: ${value}\n`;
    expect(() => lastRetrospective({ "3.md": text })).toThrow(
      new Error(
        `infra/plans/3.md:2: "${value}" is not a retrospective marker; ${FORM}`,
      ),
    );
  });

  it("opens the window at a timestamp marker's instant, and refuses a value that is not one", () => {
    expect(windowStart("2026-11-12T18:00:00Z")).toBe(
      Date.parse("2026-11-12T18:00:00Z"),
    );
    expect(() => windowStart("2026-13-45")).toThrow(
      new Error(`"2026-13-45" is not a retrospective marker; ${FORM}`),
    );
  });
});

const scanOf = (ids: string[], options?: Parameters<typeof scan>[1]) =>
  scan(
    ids.map((id) => ({ id, text: "" })),
    options,
  );

beforeEach(wireSessions);

describe("scan: which sessions it keeps", () => {
  it("keeps the sessions still active in the window, in order of their first stamp", () => {
    add("a", {}, [at("10:00:00"), at("10:05:00")]);
    add("b", {}, [at("09:00:00"), at("10:30:00")]);
    add("c", {}, ["2026-11-02T08:00:00.000Z", "2026-11-02T09:00:00.000Z"]);
    expect(
      scanOf(["a", "b", "c"], { since: "2026-11-03T10:00:00Z" }).sessions,
    ).toEqual({
      count: 2,
      first: at("09:00:00"),
      last: at("10:30:00"),
      list: [
        { id: "b", first: at("09:00:00"), last: at("10:30:00") },
        { id: "a", first: at("10:00:00"), last: at("10:05:00") },
      ],
    });
  });

  it("sums the skipped lines and leaves evidence out of the default report", () => {
    add("a", {}, undefined, 2);
    add("b", {}, undefined, 3);
    const report = scanOf(["a", "b"]);
    expect(report.skippedLines).toBe(5);
    expect(Object.keys(report)).toEqual([
      "sessions",
      "skippedLines",
      "guards",
      "failures",
      "skills",
      "subagents",
      "bareCommands",
      "corrections",
      "rules",
    ]);
  });
});

describe("scan: guards and guard-block evidence", () => {
  it("adds blocks and warnings per rule across sessions, sorted by rule name", () => {
    add("a", {
      guards: {
        "role-worktree": { blocks: 1, warnings: 0 },
        "bare-glob": { blocks: 0, warnings: 2 },
      },
    });
    add("b", { guards: { "role-worktree": { blocks: 2, warnings: 1 } } });
    expect(scanOf(["a", "b"]).guards).toEqual({
      "bare-glob": { blocks: 0, warnings: 2 },
      "role-worktree": { blocks: 3, warnings: 1 },
    });
  });

  it("records each block's location and reports what the locations hold", () => {
    const held = { "role-worktree": [{ session: "a", line: 4, excerpt: "x" }] };
    locations.sorted.mockReturnValue(held);
    add("a", {
      guardBlocks: [{ rule: "role-worktree", line: 4, excerpt: "x" }],
    });
    const report = scanOf(["a"], { evidence: true });
    expect(locations.add).toHaveBeenCalledWith("role-worktree", {
      session: "a",
      line: 4,
      excerpt: "x",
    });
    expect(report.guardEvidence).toEqual(held);
  });
});

describe("scan: warning outcomes and the audit", () => {
  const five = [1, 2, 3, 4, 5].map((line) => warning("bare-glob", line));

  it("marks a rule promotable when five or more warnings were all heeded", () => {
    add("a", { warnings: five });
    expect(scanOf(["a"], { auditRules: ["bare-glob"] }).rules).toEqual({
      promotable: ["bare-glob"],
      audit: [
        {
          rule: "bare-glob",
          status: "promotable",
          warnings: 5,
          sessions: 1,
          heeded: 5,
          overridden: 0,
          repeated: 0,
          unresolved: 0,
        },
      ],
    });
  });

  it("marks a rule not promotable when one warning was not heeded, and insufficient below five", () => {
    add("a", {
      warnings: five,
      outcome: (w) => (w.line === 5 ? "repeated" : "heeded"),
    });
    add("b", {
      warnings: [1, 2, 3, 4].map((line) => warning("unquoted-glob", line)),
    });
    const { audit, promotable } = scanOf(["a", "b"], {
      auditRules: ["bare-glob", "unquoted-glob"],
    }).rules;
    expect(promotable).toEqual([]);
    expect(audit.map(({ rule, status }) => [rule, status])).toEqual([
      ["bare-glob", "not-promotable"],
      ["unquoted-glob", "insufficient-evidence"],
    ]);
  });

  it("reports only an overridden audit warning as evidence, and ignores a rule outside the audit", () => {
    add("a", {
      warnings: [
        warning("bare-glob", 7, "skills/*/SKILL.md"),
        warning("bare-glob", 8),
        warning("unquoted-glob", 9),
      ],
      outcome: (w) => (w.line === 7 ? "overridden" : "heeded"),
    });
    scanOf(["a"], { evidence: true, auditRules: ["bare-glob"] });
    expect(locations.add.mock.calls).toEqual([
      [
        "bare-glob",
        { session: "a", line: 7, excerpt: "ls 7", glob: "skills/*/SKILL.md" },
      ],
    ]);
  });

  it("counts every overridden warning in the audit, past the 20 locations kept per rule", () => {
    const overridden = (n: number) =>
      Array.from({ length: n }, (_, i) => warning("bare-glob", i + 1));
    add("a", { warnings: overridden(15), outcome: () => "overridden" });
    add("b", { warnings: overridden(10), outcome: () => "overridden" });
    const { audit } = scanOf(["a", "b"], {
      evidence: true,
      auditRules: ["bare-glob"],
    }).rules;
    expect(audit[0]).toMatchObject({ rule: "bare-glob", overridden: 25 });
  });
});

describe("scan: failures, skills and corrections", () => {
  it("groups failures by tool and error, most frequent first, and keeps ten", () => {
    const distinct = Array.from({ length: 12 }, (_, i) => ({
      tool: `t${i}`,
      error: "e",
    }));
    const repeated = { tool: "Bash", error: "x" };
    add("a", { failures: [...distinct, repeated, repeated, repeated] });
    const failures = scanOf(["a"]).failures;
    expect(failures).toHaveLength(10);
    expect(failures[0]).toEqual({ ...repeated, count: 3 });
    expect(failures.slice(1, 3)).toEqual([
      { tool: "t0", error: "e", count: 1 },
      { tool: "t1", error: "e", count: 1 },
    ]);
  });

  it("lists the known skills a session used, and the known ones no session used", () => {
    add("a", { skills: new Set(["tdd"]), slashCommands: ["retro", "nope"] });
    expect(scanOf(["a"], { knownSkills: ["handoff", "retro"] }).skills).toEqual(
      {
        perSession: { a: ["retro", "tdd"] },
        unused: ["handoff"],
      },
    );
  });

  it("merges a correction two sessions share, drops a phrase one session says, and orders groups", () => {
    const first = "never edit the widget manifests";
    const second = "stop editing the widget manifests";
    const other = "run the retro again";
    add("a", {
      phrases: [
        { phrase: first, line: 2 },
        { phrase: second, line: 2 },
        { phrase: second, line: 4 },
        { phrase: "lonely phrase", line: 9 },
        { phrase: other, line: 5 },
      ],
    });
    add("b", {
      phrases: [
        { phrase: first, line: 2 },
        { phrase: second, line: 2 },
        { phrase: other, line: 5 },
      ],
    });
    expect(scanOf(["a", "b"]).corrections).toEqual([
      {
        id: "aaf0d1b8",
        sessions: 2,
        evidence: [
          { session: "a", line: 2 },
          { session: "b", line: 2 },
        ],
      },
      {
        id: "5c74bd4e",
        sessions: 2,
        evidence: [
          { session: "a", line: 5 },
          { session: "b", line: 5 },
        ],
      },
    ]);
  });
});

describe("scan: in-process agent launches", () => {
  it("counts them across sessions, sorted by agent", () => {
    add("a", { subagents: ["writer", "principles-review"] });
    add("b", { subagents: ["principles-review"] });
    expect(scanOf(["a", "b"]).subagents).toEqual({
      "principles-review": 2,
      writer: 1,
    });
  });
});
