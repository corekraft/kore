import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { trimCommon, type Edit } from "./edits.js";
import { activePlans } from "./parser.js";
import {
  apply,
  choosePlan,
  normalize,
  renderChanges,
  toChanges,
} from "./plan-edit.js";

// The parser and the trim helper are typed automocks; CommandError stays real.
vi.mock("./parser.js");
vi.mock("./edits.js");

const PLANS = { "2-a.md": "", "9-b.md": "", "9-c.md": "" };

beforeEach(() => {
  vi.mocked(activePlans).mockReturnValue(["2-a.md"]);
});

describe("normalize", () => {
  it("collapses every run of whitespace to one space and trims the ends", () => {
    expect(normalize("  Run \n the\tgamma  ")).toBe("Run the gamma");
  });
});

describe("choosePlan with a named plan", () => {
  it("returns the one plan whose number is named, without reading the active plans", () => {
    expect(choosePlan({ "2-a.md": "", "9-b.md": "" }, "9")).toBe("9-b.md");
    expect(activePlans).not.toHaveBeenCalled();
  });

  it("refuses a plan number that two files share, naming both", () => {
    expect(() => choosePlan(PLANS, "9")).toThrow(CommandError);
    expect(() => choosePlan(PLANS, "9")).toThrow(
      'Plan number "9" is shared by 9-b.md and 9-c.md.',
    );
  });

  it("refuses a number that names no plan, pointing to the list command", () => {
    expect(() => choosePlan(PLANS, "7")).toThrow(
      'No plan numbered "7" in infra/plans. Run `harness plan active` to list the plans.',
    );
  });

  it("refuses a name that is not a plan number, as one that names no plan", () => {
    expect(() => choosePlan(PLANS, "b")).toThrow('No plan numbered "b"');
  });
});

describe("choosePlan with no plan named", () => {
  it("returns the single active plan", () => {
    expect(choosePlan(PLANS, undefined)).toBe("2-a.md");
    expect(activePlans).toHaveBeenCalledWith(PLANS);
  });

  it("refuses when no plan is active, and says how to name one", () => {
    vi.mocked(activePlans).mockReturnValue([]);
    expect(() => choosePlan(PLANS, undefined)).toThrow(
      'No active plan: no file in infra/plans has "status: active". Name one with --plan N.',
    );
  });

  it("refuses when several plans are active, listing them", () => {
    vi.mocked(activePlans).mockReturnValue(["9-b.md", "2-a.md"]);
    expect(() => choosePlan(PLANS, undefined)).toThrow(
      "2 plans are active (9-b.md, 2-a.md), so there is no single default. Pass --plan N.",
    );
  });
});

describe("apply", () => {
  it("applies each edit at its own lines, bottom first, and leaves the input alone", () => {
    const lines = ["a", "b", "c"];
    const edits: Edit[] = [
      { start: 0, end: 1, lines: ["A"] },
      { start: 2, end: 3, lines: ["C", "C2"] },
    ];
    expect(apply(lines, edits)).toEqual(["A", "b", "C", "C2"]);
    expect(lines).toEqual(["a", "b", "c"]);
  });

  it("inserts lines where an edit's range is empty", () => {
    expect(apply(["a", "b"], [{ start: 1, end: 1, lines: ["X"] }])).toEqual([
      "a",
      "X",
      "b",
    ]);
  });
});

describe("toChanges", () => {
  it("drops an edit that trims to nothing, and reports the rest with their lines", () => {
    vi.mocked(trimCommon).mockImplementation((edit) =>
      edit.start === 2 ? null : edit,
    );
    const lines = ["a", "b", "c"];
    const edits: Edit[] = [
      { start: 2, end: 3, lines: ["c"] },
      { start: 0, end: 1, lines: ["Q"] },
    ];
    expect(toChanges(lines, edits)).toEqual([
      { line: 1, before: ["a"], after: ["Q"] },
    ]);
    expect(trimCommon).toHaveBeenCalledWith(edits[0], lines);
  });

  it("orders the changes by their line, numbering each from one", () => {
    vi.mocked(trimCommon).mockImplementation((edit) => edit);
    const lines = ["a", "b", "c"];
    const edits: Edit[] = [
      { start: 2, end: 3, lines: ["C"] },
      { start: 0, end: 2, lines: ["A"] },
    ];
    expect(toChanges(lines, edits)).toEqual([
      { line: 1, before: ["a", "b"], after: ["A"] },
      { line: 3, before: ["c"], after: ["C"] },
    ]);
  });
});

describe("renderChanges", () => {
  it("prints the headline, then each changed line as a minus row and a plus row", () => {
    expect(
      renderChanges("Set Next: in infra/plans/2-a.md", [
        { line: 3, before: ["old"], after: ["new", "more"] },
      ]),
    ).toBe(
      "Set Next: in infra/plans/2-a.md\n  line 3:\n  - old\n  + new\n  + more\n",
    );
  });
});
