import { beforeEach, describe, expect, it, vi } from "vitest";
import { trimCommon } from "./edits.js";
import { listEdits } from "./lists.js";
import { totalsEdits } from "./totals.js";

// Each collaborator is a typed automock; trimCommon passes its edit through,
// so the entry edit is the whole replaced entry.
vi.mock("./edits.js");
vi.mock("./totals.js");

const DATE = "2026-01-02";

const SECTION = [
  "## Step 1: A",
  "",
  "- [ ] First item here",
  "- [ ] Second item here",
  "- [ ] Criterion alpha holds",
  "- [ ] Criterion beta holds",
  "- [ ] Criterion gamma holds",
  "",
  "## Where each open item can be done",
  "",
  "### Local",
  "",
  "- Step 1 (5): First item here; Second item here (offline); and three exit",
  "  criteria: Criterion alpha holds; Criterion beta holds; Criterion gamma holds.",
  "",
];

const entryAt = (lines: string[]) =>
  lines.findIndex((l) => l.startsWith("- Step 1 (5)"));

beforeEach(() => {
  vi.mocked(trimCommon).mockImplementation((edit) => edit);
  vi.mocked(totalsEdits).mockReturnValue([]);
});

describe("listEdits entry edits", () => {
  it("returns no edits when the plan has no open-item section", () => {
    const lines = SECTION.slice(0, 8);
    expect(listEdits(lines, "Step 1", "First item here", DATE)).toEqual({
      edits: [],
    });
    expect(totalsEdits).not.toHaveBeenCalled();
  });

  it("refuses an item whose step has no list entry, naming the step", () => {
    expect(listEdits(SECTION, "Step 9", "First item here", DATE)).toEqual({
      error:
        "The open-item lists have no entry for Step 9. Add the item to its list, or tick it by hand.",
    });
  });

  it("removes a plain segment and lowers the entry count by one", () => {
    const at = entryAt(SECTION);
    expect(listEdits(SECTION, "Step 1", "First item here", DATE)).toEqual({
      edits: [
        {
          start: at,
          end: at + 2,
          lines: [
            "- Step 1 (4): Second item here (offline); and three exit",
            "  criteria: Criterion alpha holds; Criterion beta holds; Criterion gamma holds.",
          ],
        },
      ],
    });
  });
});

describe("listEdits segment removal", () => {
  it("lowers the exit-criteria lead when a later criterion is removed", () => {
    const at = entryAt(SECTION);
    expect(listEdits(SECTION, "Step 1", "Criterion beta holds", DATE)).toEqual({
      edits: [
        {
          start: at,
          end: at + 2,
          lines: [
            "- Step 1 (4): First item here; Second item here (offline); and two exit",
            "  criteria: Criterion alpha holds; Criterion gamma holds.",
          ],
        },
      ],
    });
  });

  it("singularises the lead at one criterion left", () => {
    const lines = [
      "## Where each open item can be done",
      "",
      "### Local",
      "",
      "- Step 1 (3): First item here; and two exit",
      "  criteria: Criterion alpha holds; Criterion beta holds.",
    ];
    expect(listEdits(lines, "Step 1", "Criterion beta holds", DATE)).toEqual({
      edits: [
        {
          start: 4,
          end: 6,
          lines: [
            "- Step 1 (2): First item here; and one exit",
            "  criterion: Criterion alpha holds.",
          ],
        },
      ],
    });
  });

  it("removes the whole entry's text when the item was its only segment", () => {
    const lines = [
      "## Where each open item can be done",
      "",
      "### Local",
      "",
      "- Step 1 (1): Only item here.",
    ];
    expect(listEdits(lines, "Step 1", "Only item here", DATE)).toEqual({
      edits: [{ start: 4, end: 5, lines: [] }],
    });
  });
});

describe("listEdits refusals", () => {
  it("refuses an item it cannot place, because two segments score close", () => {
    const words =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const near = words.replace("juliet", "kilo");
    const lines = [
      "## Where each open item can be done",
      "",
      "### Local",
      "",
      `- Step 1 (2): ${words}; ${near}`,
    ];
    expect(listEdits(lines, "Step 1", words, DATE)).toEqual({
      error:
        "Cannot tell which list entry under Step 1 holds this item. Reword the list entry to share words with the item, or tick it by hand.",
    });
  });

  it("refuses to drop a segment that a 'both' note also covers", () => {
    const lines = [
      "## Where each open item can be done",
      "",
      "### Local",
      "",
      "- Step 1 (3): First thing here; Second thing here (both offline only); Third",
      "  thing here.",
    ];
    expect(listEdits(lines, "Step 1", "Second thing here", DATE)).toEqual({
      error:
        "The note (both offline only) in the Step 1 list entry covers more than one item, so removing this one would leave it wrong. Edit the entry by hand, or reword the note.",
    });
  });

  it("returns the totals refusal unchanged, so nothing is edited", () => {
    vi.mocked(totalsEdits).mockReturnValue(
      "The totals line cannot be recounted.",
    );
    expect(listEdits(SECTION, "Step 1", "First item here", DATE)).toEqual({
      error: "The totals line cannot be recounted.",
    });
  });
});

describe("listEdits totals", () => {
  it("recounts the totals for the entry's class, with the date", () => {
    listEdits(SECTION, "Step 1", "First item here", DATE);
    expect(totalsEdits).toHaveBeenCalledWith(
      SECTION,
      [8, SECTION.length],
      "Local",
      DATE,
    );
  });

  it("appends the totals edits after the entry edit", () => {
    const totals = [{ start: 2, end: 3, lines: ["totals"] }];
    vi.mocked(totalsEdits).mockReturnValue(totals);
    const at = entryAt(SECTION);
    expect(listEdits(SECTION, "Step 1", "First item here", DATE)).toEqual({
      edits: [
        {
          start: at,
          end: at + 2,
          lines: [
            "- Step 1 (4): Second item here (offline); and three exit",
            "  criteria: Criterion alpha holds; Criterion beta holds; Criterion gamma holds.",
          ],
        },
        ...totals,
      ],
    });
  });
});
