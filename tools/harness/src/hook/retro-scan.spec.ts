// Deterministic retrospective scan: counts over session transcripts that the
// retro skill interprets.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { describe, expect, it } from "vitest";
import {
  lastRetrospective,
  parseTranscript,
  scan,
  summarizeError,
  windowStart,
} from "./retro-scan.js";
import { all, fixture, options } from "./retro-scan-support.js";

describe("retro scan report", () => {
  it("skips and counts a malformed transcript line instead of failing", () => {
    const session = parseTranscript("alpha", fixture("alpha").text);
    expect(session.skipped).toBe(1);
    expect(session.events.length).toBeGreaterThan(30);
  });

  it("leaves out sessions before the since date, with first and last timestamps", () => {
    const result = scan(all(), options);
    expect(result.sessions.list.map((session) => session.id)).toEqual([
      "alpha",
      "bravo",
    ]);
    expect(result.sessions.count).toBe(2);
    expect(result.sessions.first).toBe("2026-11-01T10:01:00.000Z");
    expect(result.sessions.last).toMatch(/^2026-11-02T/);
    expect(result.skippedLines).toBe(1);
  });

  it("counts guard warnings and blocks per rule, ignoring guard text inside file contents", () => {
    expect(scan(all(), options).guards).toEqual({
      "image-digest": { blocks: 0, warnings: 5 },
      "kubectl-context": { blocks: 1, warnings: 0 },
      "sample-audit": { blocks: 0, warnings: 2 },
      "unquoted-glob": { blocks: 0, warnings: 5 },
    });
  });

  it("groups failed tool calls by tool and normalized error, excluding guard blocks", () => {
    expect(scan(all(), options).failures).toEqual([
      { tool: "Edit", error: "String to replace not found in file.", count: 2 },
      {
        tool: "Bash",
        error: "Exit code 1: (eval):N: no matches found: <glob>",
        count: 1,
      },
    ]);
  });
});

describe("retro scan failures and skills", () => {
  it("caps failures at the top ten", () => {
    const lines: string[] = [];
    for (let n = 0; n < 12; n++) {
      const stamp = "2026-11-03T00:00:00.000Z";
      lines.push(
        JSON.stringify({
          type: "assistant",
          timestamp: stamp,
          message: {
            content: [
              { type: "tool_use", id: `t${n}`, name: `Tool${n}`, input: {} },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          timestamp: stamp,
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: `t${n}`,
                is_error: true,
                content: "boom",
              },
            ],
          },
        }),
      );
    }
    const { failures } = scan(
      [{ id: "many", text: lines.join("\n") }],
      options,
    );
    expect(failures).toHaveLength(10);
  });

  it("counts Skill calls and skill slash commands, not built-in commands", () => {
    expect(scan(all(), options).skills.perSession).toEqual({
      alpha: ["retro", "test-driven-development"],
      bravo: ["handoff"],
    });
  });

  it("reports skills that no scanned session loaded as unused", () => {
    expect(scan(all(), options).skills.unused).toEqual(["write-adr"]);
    expect(scan(all(), { ...options, since: undefined }).skills.unused).toEqual(
      [],
    );
  });
});

describe("retro scan corrections and windows", () => {
  it("reports a phrase repeated in two sessions by location, without its text", () => {
    const { corrections } = scan(all(), options);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.sessions).toBe(2);
    expect(corrections[0]?.evidence.map((item) => item.session)).toEqual([
      "alpha",
      "bravo",
    ]);
    expect(
      corrections[0]?.evidence.every((item) => Number.isInteger(item.line)),
    ).toBe(true);
    expect(JSON.stringify(corrections)).not.toMatch(/push|remote/);
  });

  it("does not take pasted content or compaction summaries as the user's own words", () => {
    const { corrections } = scan(all(), { ...options, since: undefined });
    expect(corrections).toHaveLength(1);
  });

  it("keeps a session from the day of the last retrospective, so none falls in a gap", () => {
    const result = scan(all(), { ...options, since: "2026-11-01" });
    expect(result.sessions.list.map((session) => session.id)).toEqual([
      "alpha",
      "bravo",
    ]);
  });

  it("leaves out a session that ended just before local midnight of the marker day", () => {
    const stamp = new Date("2026-11-01T00:00:00").getTime();
    const at = (ms: number) =>
      JSON.stringify({ type: "user", timestamp: new Date(ms).toISOString() });
    const result = scan(
      [
        { id: "before", text: at(stamp - 1) },
        { id: "on", text: at(stamp) },
      ],
      { since: "2026-11-01" },
    );
    expect(result.sessions.list.map((s) => s.id)).toEqual(["on"]);
  });
});

describe("retro scan window markers", () => {
  it("reads the latest retrospective date across plans and opens the window at local midnight", () => {
    expect(
      lastRetrospective({
        "1.md": "Last retrospective: 2026-10-01\n",
        "2.md":
          "- Last retrospective: 2026-11-08\n\nnote: Last retrospective: 2026-12-01\n",
      }),
    ).toBe("2026-11-08");
    expect(lastRetrospective({ "1.md": "none\n" })).toBeNull();
    expect(windowStart(undefined)).toBe(0);
    expect(windowStart("2026-11-01")).toBe(
      new Date("2026-11-01T00:00:00").getTime(),
    );
  });
});

describe("retro scan audit rules", () => {
  it("calls a rule promotable when five or more warnings were all heeded", () => {
    const { rules } = scan(all(), options);
    expect(rules.promotable).toEqual(["unquoted-glob"]);
    expect(rules.audit.find((rule) => rule.rule === "unquoted-glob")).toEqual({
      rule: "unquoted-glob",
      status: "promotable",
      warnings: 5,
      sessions: 2,
      heeded: 5,
      overridden: 0,
      repeated: 0,
      unresolved: 0,
    });
  });

  it("does not call a rule the user overrode once promotable", () => {
    const rule = scan(all(), options).rules.audit.find(
      (entry) => entry.rule === "image-digest",
    );
    expect(rule).toMatchObject({
      status: "not-promotable",
      warnings: 5,
      overridden: 1,
      heeded: 4,
    });
  });

  it("calls fewer than five warnings insufficient evidence, even if repeated", () => {
    const rule = scan(all(), options).rules.audit.find(
      (entry) => entry.rule === "sample-audit",
    );
    expect(rule).toMatchObject({
      status: "insufficient-evidence",
      warnings: 2,
      repeated: 1,
    });
  });

  it("still lists a rule with no warnings as insufficient evidence", () => {
    const { rules } = scan([fixture("charlie")], {
      ...options,
      since: undefined,
    });
    expect(rules.audit.every((r) => r.status === "insufficient-evidence")).toBe(
      true,
    );
    expect(rules.audit).toHaveLength(3);
  });
});

describe("retro scan error summaries", () => {
  it("strips paths, numbers and quotes and stays within 120 characters", () => {
    expect(
      summarizeError(
        "<tool_use_error>File /repo/a/b.ts has 42 lines and 'x y'</tool_use_error>",
      ),
    ).toBe("File <path> has N lines and <q>");
    expect(summarizeError("Exit code 137")).toBe("Exit code 137");
    expect(
      summarizeError("Exit code 1\nsome file contents\nmore contents"),
    ).toBe("Exit code 1");
    expect(
      summarizeError(`Error ${"word ".repeat(80)}`).length,
    ).toBeLessThanOrEqual(120);
  });

  it("keeps whole-word keywords and shell-reported lines as errors", () => {
    expect(summarizeError("Exit code 1\nbuild failed")).toBe(
      "Exit code 1: build failed",
    );
    expect(summarizeError("Exit code 1\n3 failures")).toBe(
      "Exit code 1: N failures",
    );
    expect(summarizeError("Exit code 2\nbash: foo: command not found")).toBe(
      "Exit code 2: bash: foo: command not found",
    );
    expect(summarizeError("Exit code 1\nsh: 1: oops")).toBe(
      "Exit code 1: sh: N: oops",
    );
  });
});
