import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../runtime/index.js";
import type { WorkPiece } from "./judgment-check.js";
import { checkWork } from "./judgment-work.js";
import { TickPlanStore } from "./tick-plan-store.js";

vi.mock("./judgment-work.js", () => ({ checkWork: vi.fn() }));

const DIR = "/main/.kore/state/tick-plans";
const PLAN_PATH = `${DIR}/0007.json`;

const DOCS: WorkPiece = {
  role: "writer",
  name: "docs",
  brief: "Document the piece.",
  files: ["docs/guides/contributor.md"],
  after: [],
};

const WORK = [DOCS];

function fakeFs(files: Record<string, string> = {}) {
  const writeFile = vi.fn(() => Promise.resolve());
  const fs = {
    exists: vi.fn((path: string) => Promise.resolve(path in files)),
    readFile: vi.fn((path: string) => Promise.resolve(files[path] ?? "")),
    writeFile,
  } as unknown as FileSystem;
  return { fs, writeFile };
}

beforeEach(() => {
  vi.mocked(checkWork).mockReturnValue({
    ok: true,
    plan: { kind: "work", work: WORK },
  });
});

describe("TickPlanStore.read", () => {
  it("reads nothing when the idea has no persisted plan", async () => {
    const { fs } = fakeFs();
    const store = new TickPlanStore(fs, DIR);
    expect(await store.read("0007")).toBeUndefined();
  });

  it("returns the idea's persisted plan with its issue and its work", async () => {
    const stored = JSON.stringify({
      schema: 1,
      idea: "0007",
      issue: 794,
      work: WORK,
    });
    const { fs } = fakeFs({ [PLAN_PATH]: stored });
    const store = new TickPlanStore(fs, DIR);
    expect(await store.read("0007")).toEqual({
      schema: 1,
      idea: "0007",
      issue: 794,
      work: WORK,
    });
  });

  it("refuses a persisted plan that no longer checks, naming the file to fix", async () => {
    vi.mocked(checkWork).mockReturnValue({
      ok: false,
      error: "Plan work item 1 has field name: bad.",
    });
    const stored = JSON.stringify({
      schema: 1,
      idea: "0007",
      issue: 794,
      work: WORK,
    });
    const { fs } = fakeFs({ [PLAN_PATH]: stored });
    const store = new TickPlanStore(fs, DIR);
    await expect(store.read("0007")).rejects.toThrow(
      `The persisted plan ${PLAN_PATH} no longer checks: Plan work item 1 has field name: bad.`,
    );
  });
});

describe("TickPlanStore.write", () => {
  it("writes a new plan as JSON for its idea and says it was written", async () => {
    const { fs, writeFile } = fakeFs();
    const store = new TickPlanStore(fs, DIR);
    expect(await store.write({ idea: "0007", issue: 794, work: WORK })).toEqual(
      { status: "written" },
    );
    expect(writeFile).toHaveBeenCalledWith(
      PLAN_PATH,
      `${JSON.stringify({ schema: 1, idea: "0007", issue: 794, work: WORK }, null, 2)}\n`,
    );
  });

  it("writes nothing again when the same plan is already persisted", async () => {
    const stored = JSON.stringify({
      schema: 1,
      idea: "0007",
      issue: 794,
      work: WORK,
    });
    const { fs, writeFile } = fakeFs({ [PLAN_PATH]: stored });
    const store = new TickPlanStore(fs, DIR);
    expect(await store.write({ idea: "0007", issue: 794, work: WORK })).toEqual(
      { status: "same" },
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("refuses a different plan for an idea that already has one, and changes nothing", async () => {
    const stored = JSON.stringify({
      schema: 1,
      idea: "0007",
      issue: 794,
      work: WORK,
    });
    const { fs, writeFile } = fakeFs({ [PLAN_PATH]: stored });
    const store = new TickPlanStore(fs, DIR);
    const other = [{ ...DOCS, brief: "Something else." }];
    expect(
      await store.write({ idea: "0007", issue: 794, work: other }),
    ).toEqual({
      status: "refused",
      error:
        "Idea 0007 already has a persisted work plan that differs from this one; nothing was changed. The owner decides whether to replace it.",
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("refuses an idea whose name could escape the plans directory, and writes nothing", async () => {
    const { fs, writeFile } = fakeFs();
    const store = new TickPlanStore(fs, DIR);
    expect(await store.write({ idea: "../x", issue: 794, work: WORK })).toEqual(
      {
        status: "refused",
        error:
          'Idea "../x" is not a usable idea name; use lowercase letters, digits and dashes.',
      },
    );
    expect(writeFile).not.toHaveBeenCalled();
  });
});
