import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { planClearNext, planNext } from "./next.js";
import {
  apply,
  choosePlan,
  normalize,
  renderChanges,
  toChanges,
} from "./plan-edit.js";
import { nextBlocks, nextStep, openCounts } from "./parser.js";
import { readPlans } from "./store.js";
import { fakeDeps, ROOT } from "./plan-support.js";

// Every collaborator is a typed automock; node:path joins for real.
vi.mock("node:path");
vi.mock("./parser.js");
vi.mock("./plan-edit.js");
vi.mock("./store.js");

const FILE = "infra/plans/2-a.md";
const CHANGE = { line: 3, before: ["x"], after: ["y"] };

/** Two steps, each with an open item; `Next:` lines come from the parser mock. */
const MD = [
  "## Step 1: A",
  "",
  "- [ ] one",
  "",
  "## Step 2: B",
  "",
  "- [ ] two",
  "",
].join("\n");
const LINES = MD.split("\n");

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(readPlans).mockResolvedValue({ "2-a.md": MD });
  vi.mocked(choosePlan).mockReturnValue("2-a.md");
  vi.mocked(normalize).mockImplementation((text) => text);
  vi.mocked(apply).mockReturnValue(["applied"]);
  vi.mocked(renderChanges).mockReturnValue("RENDERED");
  vi.mocked(toChanges).mockReturnValue([CHANGE]);
  vi.mocked(nextBlocks).mockReturnValue([]);
  vi.mocked(nextStep).mockReturnValue(null);
  vi.mocked(openCounts).mockReturnValue([
    { step: "Step 1", count: 1 },
    { step: "Step 2", count: 1 },
  ]);
});

describe("planNext placement", () => {
  it("adds the Next: line under the first step with open items, with a blank line after it", async () => {
    const deps = fakeDeps();
    expect(
      await planNext.run({
        json: false,
        deps,
        options: { text: "Run it" },
      }),
    ).toBe(0);
    expect(vi.mocked(apply).mock.calls).toEqual([
      [LINES, [{ start: 2, end: 2, lines: ["Next: Run it", ""] }]],
    ]);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(
      `${ROOT}/${FILE}`,
      "applied",
    );
  });

  it("adds a blank line on each side of the Next: line when a list follows the heading", async () => {
    const lines = ["## Step 1: A", "- [ ] one", ""];
    vi.mocked(readPlans).mockResolvedValue({ "2-a.md": lines.join("\n") });
    await planNext.run({
      json: false,
      deps: fakeDeps(),
      options: { text: "Begin" },
    });
    expect(vi.mocked(apply).mock.calls).toEqual([
      [lines, [{ start: 1, end: 1, lines: ["", "Next: Begin", ""] }]],
    ]);
  });
});

describe("planNext with an existing Next: line", () => {
  it("replaces a Next: paragraph and its blank line, then inserts under the current step", async () => {
    const lines = [
      "## Step 1: A",
      "",
      "Next: old",
      "  wraps.",
      "",
      "- [ ] one",
    ];
    vi.mocked(readPlans).mockResolvedValue({ "2-a.md": lines.join("\n") });
    vi.mocked(nextBlocks).mockReturnValue([
      { step: "Step 1: A", text: "old wraps.", line: 2, end: 4 },
    ]);
    vi.mocked(nextStep).mockReturnValue({ step: "Step 1: A", text: "old" });
    vi.mocked(openCounts).mockReturnValue([{ step: "Step 1", count: 1 }]);
    await planNext.run({
      json: false,
      deps: fakeDeps(),
      options: { text: "New" },
    });
    expect(vi.mocked(apply).mock.calls).toEqual([
      [lines, [{ start: 2, end: 5, lines: ["Next: New", ""] }]],
    ]);
  });

  it("does not add a second blank line when the heading is already followed by one", async () => {
    const lines = ["## Step 1: A", "", "", "- [ ] one"];
    vi.mocked(readPlans).mockResolvedValue({ "2-a.md": lines.join("\n") });
    vi.mocked(openCounts).mockReturnValue([{ step: "Step 1", count: 1 }]);
    await planNext.run({
      json: false,
      deps: fakeDeps(),
      options: { text: "X" },
    });
    expect(vi.mocked(apply).mock.calls).toEqual([
      [lines, [{ start: 2, end: 2, lines: ["Next: X"] }]],
    ]);
  });

  it("moves the Next: line to the first open step when its own step is finished", async () => {
    vi.mocked(nextStep).mockReturnValue({ step: "Step 9: Z", text: "old" });
    await planNext.run({
      json: false,
      deps: fakeDeps(),
      options: { text: "Start" },
    });
    expect(vi.mocked(apply).mock.calls[0]?.[1]).toEqual([
      { start: 2, end: 2, lines: ["Next: Start", ""] },
    ]);
  });
});

describe("planNext refusals", () => {
  it("refuses missing text before it reads any plan", async () => {
    const deps = fakeDeps();
    await expect(
      planNext.run({ json: false, deps, options: {} }),
    ).rejects.toThrow(CommandError);
    expect(readPlans).not.toHaveBeenCalled();
  });

  it("refuses a plan with no open item, and writes nothing", async () => {
    vi.mocked(openCounts).mockReturnValue([]);
    const deps = fakeDeps();
    await expect(
      planNext.run({ json: false, deps, options: { text: "x" } }),
    ).rejects.toThrow("The plan has no open item");
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });
});

describe("planNext output", () => {
  it("writes nothing under --dry-run and reports the changes as a dry run", async () => {
    const deps = fakeDeps();
    await planNext.run({
      json: false,
      deps,
      options: { text: "New", "dry-run": true },
    });
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
    expect(renderChanges).toHaveBeenCalledWith(`Would set Next: in ${FILE}`, [
      CHANGE,
    ]);
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([["RENDERED"]]);
  });

  it("reports the line as already right, and writes nothing, when no line changes", async () => {
    vi.mocked(toChanges).mockReturnValue([]);
    const deps = fakeDeps();
    await planNext.run({ json: false, deps, options: { text: "New" } });
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      [`Next: already reads that way in ${FILE}\n`],
    ]);
  });

  it("prints the plan, the write and every change as one JSON line", async () => {
    const deps = fakeDeps();
    await planNext.run({ json: true, deps, options: { text: "New" } });
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      [
        `${JSON.stringify({
          plan: FILE,
          dryRun: false,
          written: true,
          changes: [CHANGE],
        })}\n`,
      ],
    ]);
  });

  it("passes the --plan option to the plan choice", async () => {
    await planNext.run({
      json: false,
      deps: fakeDeps(),
      options: { text: "New", plan: "2" },
    });
    expect(choosePlan).toHaveBeenCalledWith({ "2-a.md": MD }, "2");
  });
});

describe("planClearNext", () => {
  it("removes a Next: paragraph with its blank line and writes the result", async () => {
    const lines = ["## Step 1: A", "", "Next: old", "", "- [ ] one"];
    vi.mocked(readPlans).mockResolvedValue({ "2-a.md": lines.join("\n") });
    vi.mocked(nextBlocks).mockReturnValue([
      { step: "Step 1: A", text: "old", line: 2, end: 3 },
    ]);
    const deps = fakeDeps();
    expect(await planClearNext.run({ json: false, deps, options: {} })).toBe(0);
    expect(vi.mocked(apply).mock.calls).toEqual([
      [lines, [{ start: 2, end: 4, lines: [] }]],
    ]);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(
      `${ROOT}/${FILE}`,
      "applied",
    );
  });

  it("writes nothing and says so when there is no Next: line", async () => {
    vi.mocked(toChanges).mockReturnValue([]);
    const deps = fakeDeps();
    expect(await planClearNext.run({ json: false, deps, options: {} })).toBe(0);
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      [`No Next: line to clear in ${FILE}\n`],
    ]);
  });

  it("headlines a dry run as a clear that would happen", async () => {
    const deps = fakeDeps();
    await planClearNext.run({
      json: false,
      deps,
      options: { "dry-run": true },
    });
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
    expect(renderChanges).toHaveBeenCalledWith(`Would clear Next: in ${FILE}`, [
      CHANGE,
    ]);
  });
});
