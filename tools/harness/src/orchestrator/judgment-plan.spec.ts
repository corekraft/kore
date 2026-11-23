import { describe, expect, it } from "vitest";
import { BRIEF_MAX, TEXT_MAX, checkPlan } from "./judgment-plan.js";

const SUFFIX =
  "The whole plan is refused and nothing was started; fix the judgment pane's plan and rerun.";

const piece = (overrides: Record<string, unknown> = {}) => ({
  role: "writer",
  name: "split-a",
  brief: "Write the first half of the change",
  files: ["tools/harness/src/orchestrator/a.ts"],
  after: [],
  ...overrides,
});

describe("checkPlan: accepted plans", () => {
  it("accepts a reads plan and returns it as a plan", () => {
    const raw = {
      reads: [
        {
          question: "Which files does the retro filing use?",
          paths: ["tools/harness/src/orchestrator/retro-filing.ts"],
        },
      ],
    };
    expect(checkPlan(raw)).toEqual({
      ok: true,
      plan: {
        kind: "reads",
        reads: [
          {
            question: "Which files does the retro filing use?",
            paths: ["tools/harness/src/orchestrator/retro-filing.ts"],
          },
        ],
      },
    });
  });
});

describe("checkPlan: accepted work", () => {
  it("accepts a work plan whose pieces wait on each other by name", () => {
    const raw = {
      work: [
        piece({ name: "split-a" }),
        piece({
          name: "split-b",
          role: "reader",
          files: [],
          after: ["split-a"],
        }),
      ],
    };
    expect(checkPlan(raw)).toEqual({
      ok: true,
      plan: {
        kind: "work",
        work: [
          {
            role: "writer",
            name: "split-a",
            brief: "Write the first half of the change",
            files: ["tools/harness/src/orchestrator/a.ts"],
            after: [],
          },
          {
            role: "reader",
            name: "split-b",
            brief: "Write the first half of the change",
            files: [],
            after: ["split-a"],
          },
        ],
      },
    });
  });

  it("accepts a stop plan that carries a reason", () => {
    expect(checkPlan({ stop: { reason: "Needs the owner's call" } })).toEqual({
      ok: true,
      plan: { kind: "stop", reason: "Needs the owner's call" },
    });
  });
});

describe("checkPlan: the plan's shape", () => {
  it("refuses a plan that is not one JSON object", () => {
    expect(checkPlan([{ stop: { reason: "x" } }])).toEqual({
      ok: false,
      error: `The plan is not one JSON object; it must be one object with exactly one of reads, work or stop. ${SUFFIX}`,
    });
  });

  it("refuses a plan with no key among reads, work and stop", () => {
    expect(checkPlan({})).toEqual({
      ok: false,
      error: `The plan must have exactly one of reads, work or stop; it has none. ${SUFFIX}`,
    });
  });

  it("refuses a plan with two of reads, work and stop, and names them", () => {
    const raw = { reads: [], stop: { reason: "x" } };
    expect(checkPlan(raw)).toEqual({
      ok: false,
      error: `The plan must have exactly one of reads, work or stop; it has 2 (reads, stop). ${SUFFIX}`,
    });
  });

  it("refuses a spawn field, since the pane never spawns", () => {
    const raw = { stop: { reason: "x" }, spawn: { role: "writer" } };
    expect(checkPlan(raw)).toEqual({
      ok: false,
      error: `The plan has the unknown field spawn; use only reads, work or stop. ${SUFFIX}`,
    });
  });
});

describe("checkPlan: reads", () => {
  it("refuses a reads item with no question and names the item and field", () => {
    const raw = { reads: [{ paths: ["docs/index.md"] }] };
    expect(checkPlan(raw)).toEqual({
      ok: false,
      error: `Plan reads item 1 has field question: give it a non-empty string. ${SUFFIX}`,
    });
  });

  it("refuses a reads path that is absolute or climbs out of the repository", () => {
    const absolute = { reads: [{ question: "q", paths: ["/etc/hosts"] }] };
    const climbs = { reads: [{ question: "q", paths: ["docs/../../secret"] }] };
    expect(checkPlan(absolute)).toEqual({
      ok: false,
      error: `Plan reads item 1 has field paths: the path "/etc/hosts" is not inside the repository; use a path relative to the repository root. ${SUFFIX}`,
    });
    expect(checkPlan(climbs)).toEqual({
      ok: false,
      error: `Plan reads item 1 has field paths: the path "docs/../../secret" is not inside the repository; use a path relative to the repository root. ${SUFFIX}`,
    });
  });

  it("refuses a question over the text cap", () => {
    const question = "q".repeat(TEXT_MAX + 1);
    expect(
      checkPlan({ reads: [{ question, paths: ["docs/index.md"] }] }),
    ).toEqual({
      ok: false,
      error: `Plan reads item 1 has field question: it is over ${TEXT_MAX} characters; shorten it. ${SUFFIX}`,
    });
  });

  it("refuses an empty reads list, since reads must ask something", () => {
    expect(checkPlan({ reads: [] })).toEqual({
      ok: false,
      error: `Plan reads has field reads: give it at least one question. ${SUFFIX}`,
    });
  });
});

describe("checkPlan: work pieces", () => {
  it("refuses a work item whose role is not writer or reader", () => {
    expect(checkPlan({ work: [piece({ role: "judge" })] })).toEqual({
      ok: false,
      error: `Plan work item 1 has field role: use writer or reader. ${SUFFIX}`,
    });
  });

  it("refuses a brief over the brief cap and names the item", () => {
    const brief = "b".repeat(BRIEF_MAX + 1);
    expect(
      checkPlan({ work: [piece(), piece({ name: "split-b", brief })] }),
    ).toEqual({
      ok: false,
      error: `Plan work item 2 has field brief: it is over ${BRIEF_MAX} characters; shorten it. ${SUFFIX}`,
    });
  });

  it("refuses a name that is not lowercase words, or that repeats", () => {
    expect(checkPlan({ work: [piece({ name: "Split A" })] })).toEqual({
      ok: false,
      error: `Plan work item 1 has field name: use lowercase letters, digits and dashes, starting with a letter. ${SUFFIX}`,
    });
    expect(
      checkPlan({
        work: [piece({ name: "split-a" }), piece({ name: "split-a" })],
      }),
    ).toEqual({
      ok: false,
      error: `Plan work item 2 has field name: the name split-a is already used by item 1. ${SUFFIX}`,
    });
  });
});

describe("checkPlan: waits and whole plans", () => {
  it("refuses an after that names no piece in the plan, or the piece itself", () => {
    expect(checkPlan({ work: [piece({ after: ["ghost"] })] })).toEqual({
      ok: false,
      error: `Plan work item 1 has field after: the piece ghost is not in this plan. ${SUFFIX}`,
    });
    expect(checkPlan({ work: [piece({ after: ["split-a"] })] })).toEqual({
      ok: false,
      error: `Plan work item 1 has field after: a piece cannot wait on itself. ${SUFFIX}`,
    });
  });

  it("refuses waits that loop back on each other", () => {
    const raw = {
      work: [
        piece({ name: "split-a", after: ["split-b"] }),
        piece({ name: "split-b", after: ["split-a"] }),
      ],
    };
    expect(checkPlan(raw)).toEqual({
      ok: false,
      error: `Plan work item 1 has field after: the waits form a loop through split-a and split-b. ${SUFFIX}`,
    });
  });
});

describe("checkPlan: files, stray fields and stops", () => {
  it("refuses a work file outside the repository", () => {
    expect(
      checkPlan({ work: [piece({ files: ["~/.ssh/id_ed25519"] })] }),
    ).toEqual({
      ok: false,
      error: `Plan work item 1 has field files: the path "~/.ssh/id_ed25519" is not inside the repository; use a path relative to the repository root. ${SUFFIX}`,
    });
  });

  it("refuses a stray field on a work item", () => {
    expect(checkPlan({ work: [piece({ model: "claude-opus-5-5" })] })).toEqual({
      ok: false,
      error: `Plan work item 1 has the unknown field model; use only role, name, brief, files, after. ${SUFFIX}`,
    });
  });
});

describe("checkPlan: whole plans and stops", () => {
  it("refuses a whole plan when one item is bad, and names only that item", () => {
    const raw = {
      work: [
        piece({ name: "split-a" }),
        piece({ name: "split-b", role: "judge" }),
      ],
    };
    const result = checkPlan(raw);
    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: `Plan work item 2 has field role: use writer or reader. ${SUFFIX}`,
    });
  });

  it("refuses a stop with no reason", () => {
    expect(checkPlan({ stop: { reason: "" } })).toEqual({
      ok: false,
      error: `Plan stop has field reason: give it a non-empty string. ${SUFFIX}`,
    });
  });
});
