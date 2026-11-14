import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Runtime from "../runtime/index.js";
import { CommandError, localDate } from "../runtime/index.js";
import { listEdits } from "./lists.js";
import { listItemSpans, type ItemSpan } from "./parser.js";
import { planTick } from "./tick.js";
import {
  apply,
  choosePlan,
  normalize,
  renderChanges,
  toChanges,
} from "./plan-edit.js";
import { readPlans } from "./store.js";
import { fakeDeps, ROOT } from "./plan-support.js";

// localDate keeps the real CommandError; every other collaborator is a typed automock.
vi.mock("../runtime/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Runtime>()),
  localDate: vi.fn(),
}));
vi.mock("node:path");
vi.mock("./lists.js");
vi.mock("./parser.js");
vi.mock("./plan-edit.js");
vi.mock("./store.js");

const FILE = "infra/plans/2-a.md";
const MD = [
  "## Step 1: A",
  "",
  "- [ ] Wire the alpha gate",
  "- [x] Done already",
  "",
  "## Step 2: B",
  "",
  "- [ ] Ship the gamma release",
  "",
].join("\n");
const LINES = MD.split("\n");

const WIRE: ItemSpan = {
  heading: "Step 1: A",
  text: "- [ ] Wire the alpha gate",
  line: 2,
  end: 3,
};
const DONE: ItemSpan = {
  heading: "Step 1: A",
  text: "- [x] Done already",
  line: 3,
  end: 4,
};
const GAMMA: ItemSpan = {
  heading: "Step 2: B",
  text: "- [ ] Ship the gamma release",
  line: 7,
  end: 8,
};
const CHANGE = { line: 3, before: ["x"], after: ["y"] };
const TICK_EDIT = { start: 2, end: 3, lines: ["- [x] Wire the alpha gate"] };
const LIST_EDIT = { start: 9, end: 10, lines: ["- Step 1 (1): Tag it."] };

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(readPlans).mockResolvedValue({ "2-a.md": MD });
  vi.mocked(choosePlan).mockReturnValue("2-a.md");
  vi.mocked(normalize).mockImplementation((text) => text.trim());
  vi.mocked(listItemSpans).mockReturnValue([WIRE, DONE, GAMMA]);
  vi.mocked(listEdits).mockReturnValue({ edits: [LIST_EDIT] });
  vi.mocked(localDate).mockReturnValue("2026-01-02");
  vi.mocked(toChanges).mockReturnValue([CHANGE]);
  vi.mocked(apply).mockReturnValue(["applied"]);
  vi.mocked(renderChanges).mockReturnValue("RENDERED");
});

describe("planTick writing", () => {
  it("ticks the matching open item and applies its edit with the list edit", async () => {
    const deps = fakeDeps();
    expect(
      await planTick.run({
        json: false,
        deps,
        options: { item: "Wire the alpha gate" },
      }),
    ).toBe(0);
    expect(vi.mocked(apply).mock.calls).toEqual([
      [LINES, [TICK_EDIT, LIST_EDIT]],
    ]);
    expect(deps.fs.writeFile).toHaveBeenCalledWith(
      `${ROOT}/${FILE}`,
      "applied",
    );
  });

  it("looks up the open-item lists by the item's step, text and the local date", async () => {
    const deps = fakeDeps();
    await planTick.run({
      json: false,
      deps,
      options: { item: "Wire the alpha gate" },
    });
    expect(listEdits).toHaveBeenCalledWith(
      LINES,
      "Step 1",
      "Wire the alpha gate",
      "2026-01-02",
    );
    expect(localDate).toHaveBeenCalledWith(new Date("2026-01-02T12:00:00Z"));
  });

  it("passes the --plan option to the plan choice", async () => {
    await planTick.run({
      json: false,
      deps: fakeDeps(),
      options: { item: "Ship the gamma", plan: "9" },
    });
    expect(choosePlan).toHaveBeenCalledWith({ "2-a.md": MD }, "9");
  });

  it("refuses a missing or blank --item before it reads any plan", async () => {
    const deps = fakeDeps();
    await expect(
      planTick.run({ json: false, deps, options: {} }),
    ).rejects.toThrow('Missing --item "<text>": say which open item to tick.');
    await expect(
      planTick.run({ json: false, deps, options: { item: "  " } }),
    ).rejects.toThrow(CommandError);
    expect(readPlans).not.toHaveBeenCalled();
  });
});

describe("planTick output", () => {
  it("reports a dry run as would-tick, and writes nothing", async () => {
    const deps = fakeDeps();
    await planTick.run({
      json: false,
      deps,
      options: { item: "Wire the alpha gate", "dry-run": true },
    });
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
    expect(renderChanges).toHaveBeenCalledWith(
      `Would tick Step 1: Wire the alpha gate in ${FILE}`,
      [CHANGE],
    );
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([["RENDERED"]]);
  });

  it("reports a written tick with the rendered changes", async () => {
    const deps = fakeDeps();
    await planTick.run({
      json: false,
      deps,
      options: { item: "Wire the alpha gate" },
    });
    expect(renderChanges).toHaveBeenCalledWith(
      `Ticked Step 1: Wire the alpha gate in ${FILE}`,
      [CHANGE],
    );
  });

  it("prints the item, the write and the changes as one JSON line", async () => {
    const deps = fakeDeps();
    await planTick.run({
      json: true,
      deps,
      options: { item: "Wire the alpha gate" },
    });
    expect(vi.mocked(deps.stdout).mock.calls).toEqual([
      [
        `${JSON.stringify({
          plan: FILE,
          item: { step: "Step 1", text: "Wire the alpha gate" },
          dryRun: false,
          written: true,
          changes: [CHANGE],
        })}\n`,
      ],
    ]);
  });
});

describe("planTick refusals", () => {
  it("refuses an item that matches no open item, pointing to the list command", async () => {
    vi.mocked(listItemSpans).mockReturnValue([WIRE]);
    const deps = fakeDeps();
    await expect(
      planTick.run({ json: false, deps, options: { item: "Nonexistent" } }),
    ).rejects.toThrow(
      '"Nonexistent" matches no open item. Run `harness plan active` to see the open items.',
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("says an item is already ticked when only a ticked item matches", async () => {
    await expect(
      planTick.run({
        json: false,
        deps: fakeDeps(),
        options: { item: "Done already" },
      }),
    ).rejects.toThrow(
      '"Done already" matches no open item. It is already ticked.',
    );
  });

  it("refuses an item that matches several open items, and writes nothing", async () => {
    vi.mocked(listItemSpans).mockReturnValue([
      { ...WIRE, text: "- [ ] the first" },
      { ...GAMMA, text: "- [ ] the second" },
    ]);
    const deps = fakeDeps();
    await expect(
      planTick.run({ json: false, deps, options: { item: "the" } }),
    ).rejects.toThrow(
      '"the" matches 2 open items. Use a longer, more specific part of the item text.',
    );
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses when the open-item lists cannot take the change, and writes nothing", async () => {
    vi.mocked(listEdits).mockReturnValue({ error: "No entry for Step 1." });
    const deps = fakeDeps();
    await expect(
      planTick.run({
        json: false,
        deps,
        options: { item: "Wire the alpha gate" },
      }),
    ).rejects.toThrow("No entry for Step 1.");
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });
});
