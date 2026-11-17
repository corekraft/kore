import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPaths, textProblem } from "./judgment-check.js";
import { checkWork } from "./judgment-work.js";

vi.mock("./judgment-check.js", () => ({
  BRIEF_MAX: 600,
  refuse: (problem: string) => ({ ok: false, error: `REFUSE ${problem}` }),
  fieldRefusal: (where: string, field: string, problem: string) => ({
    ok: false,
    error: `FIELD ${where} | ${field} | ${problem}`,
  }),
  textProblem: vi.fn(() => undefined),
  checkPaths: vi.fn((value: unknown) =>
    Array.isArray(value)
      ? { ok: true, paths: value }
      : { ok: false, problem: "give it a list of paths" },
  ),
  isRecord: (value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  strayField: (value: Record<string, unknown>, allowed: readonly string[]) =>
    Object.keys(value).find((key) => !allowed.includes(key)),
}));

const piece = (overrides: Record<string, unknown> = {}) => ({
  role: "writer",
  name: "split-a",
  brief: "Write the first half",
  files: ["tools/harness/src/a.ts"],
  after: [],
  ...overrides,
});

describe("checkWork: the list and an accepted plan", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("refuses an empty work list, or one that is not a list", () => {
    expect(checkWork([])).toEqual({
      ok: false,
      error: "FIELD Plan work | work | give it at least one piece",
    });
    expect(checkWork("split-a")).toEqual({
      ok: false,
      error: "FIELD Plan work | work | give it at least one piece",
    });
  });

  it("returns pieces that pass every check as a work plan, in order", () => {
    expect(
      checkWork([piece(), piece({ name: "split-b", after: ["split-a"] })]),
    ).toEqual({
      ok: true,
      plan: {
        kind: "work",
        work: [
          {
            role: "writer",
            name: "split-a",
            brief: "Write the first half",
            files: ["tools/harness/src/a.ts"],
            after: [],
          },
          {
            role: "writer",
            name: "split-b",
            brief: "Write the first half",
            files: ["tools/harness/src/a.ts"],
            after: ["split-a"],
          },
        ],
      },
    });
  });
});

describe("checkWork: one item", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("names an item that is not an object", () => {
    expect(checkWork([3])).toEqual({
      ok: false,
      error: "REFUSE Plan work item 1 is not an object.",
    });
  });

  it("names an unknown field on an item", () => {
    expect(checkWork([piece({ model: "claude-opus-5-5" })])).toEqual({
      ok: false,
      error:
        "REFUSE Plan work item 1 has the unknown field model; use only role, name, brief, files, after.",
    });
  });

  it("names the role when it is not writer or reader", () => {
    expect(checkWork([piece({ role: "judge" })])).toEqual({
      ok: false,
      error: "FIELD Plan work item 1 | role | use writer or reader",
    });
  });

  it("names the name when it is not lowercase words", () => {
    expect(checkWork([piece({ name: "Split A" })])).toEqual({
      ok: false,
      error:
        "FIELD Plan work item 1 | name | use lowercase letters, digits and dashes, starting with a letter",
    });
  });

  it("names the earlier item when a name repeats", () => {
    expect(checkWork([piece(), piece()])).toEqual({
      ok: false,
      error:
        "FIELD Plan work item 2 | name | the name split-a is already used by item 1",
    });
  });

  it("names the brief when the brief check refuses it", () => {
    vi.mocked(textProblem).mockReturnValueOnce(
      "it is over 600 characters; shorten it",
    );
    expect(checkWork([piece()])).toEqual({
      ok: false,
      error:
        "FIELD Plan work item 1 | brief | it is over 600 characters; shorten it",
    });
  });

  it("names the files when the path check refuses them", () => {
    vi.mocked(checkPaths).mockReturnValueOnce({
      ok: false,
      problem: 'the path "/etc/hosts" is not inside the repository',
    });
    expect(checkWork([piece({ files: ["/etc/hosts"] })])).toEqual({
      ok: false,
      error:
        'FIELD Plan work item 1 | files | the path "/etc/hosts" is not inside the repository',
    });
  });

  it("names after when it is not a list of piece names", () => {
    expect(checkWork([piece({ after: "split-a" })])).toEqual({
      ok: false,
      error: "FIELD Plan work item 1 | after | give it a list of piece names",
    });
  });
});

describe("checkWork: waits between pieces", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("refuses a piece that waits on itself", () => {
    expect(checkWork([piece({ after: ["split-a"] })])).toEqual({
      ok: false,
      error: "FIELD Plan work item 1 | after | a piece cannot wait on itself",
    });
  });

  it("refuses a wait on a piece that is not in the plan", () => {
    expect(checkWork([piece({ after: ["ghost"] })])).toEqual({
      ok: false,
      error:
        "FIELD Plan work item 1 | after | the piece ghost is not in this plan",
    });
  });

  it("names the pieces on a loop, in plan order", () => {
    expect(
      checkWork([
        piece({ name: "split-a", after: ["split-b"] }),
        piece({ name: "split-b", after: ["split-a"] }),
      ]),
    ).toEqual({
      ok: false,
      error:
        "FIELD Plan work item 1 | after | the waits form a loop through split-a and split-b",
    });
  });

  it("names every piece on a loop of three", () => {
    expect(
      checkWork([
        piece({ name: "split-a", after: ["split-b"] }),
        piece({ name: "split-b", after: ["split-c"] }),
        piece({ name: "split-c", after: ["split-a"] }),
      ]),
    ).toEqual({
      ok: false,
      error:
        "FIELD Plan work item 1 | after | the waits form a loop through split-a, split-b and split-c",
    });
  });

  it("accepts a chain of waits that does not loop", () => {
    expect(
      checkWork([
        piece({ name: "split-a" }),
        piece({ name: "split-b", after: ["split-a"] }),
        piece({ name: "split-c", after: ["split-b"] }),
      ]).ok,
    ).toBe(true);
  });
});
