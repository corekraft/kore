// The vision's Decisions list: each label must match the status of the ADRs it links.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { beforeEach, expect, test, vi } from "vitest";
import { PROBLEM } from "./kb-support.js";
import { finding } from "./markdown.js";
import { VisionCheck, type AdrState } from "./vision-check.js";

vi.mock("./markdown.js", () => ({ finding: vi.fn() }));

const FILE = "docs/vision.md";
const STATES: Record<string, AdrState> = {
  "0037": { status: "proposed" },
  "0040": { status: "accepted" },
  "0041": { status: "proposed" },
  "0060": { status: "superseded", supersededBy: "0081" },
};

const check = (text: string) =>
  new VisionCheck((adr) => STATES[adr] ?? null).check(text);
const decisions = (...items: string[]) =>
  ["# Vision", "", "## Decisions", "", ...items].join("\n");
const item = (n: number, label: string, ...adrs: string[]) =>
  `${n}. **Thing.** ${label}: words\n   ${adrs.map((a) => `([ADR ${a}](decisions/${a}-x.md))`).join(" ")}`;
const calls = () => vi.mocked(finding).mock.calls;

beforeEach(() => {
  vi.mocked(finding).mockReturnValue(PROBLEM);
});

test("a Decisions list whose labels match their ADR statuses has no findings", () => {
  const text = decisions(
    item(1, "Chosen, proposed (ADR 0037)", "0037"),
    item(2, "Decided", "0040"),
  );
  expect(check(text)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("Decided beside a proposed ADR is reported with the label to use", () => {
  const found = check(decisions(item(1, "Decided", "0037")));
  expect(found).toEqual([PROBLEM]);
  expect(calls()).toEqual([
    [
      FILE,
      5,
      "Decision 1 says Decided but ADR 0037 is proposed",
      'change its label to "Chosen, proposed (ADR 0037)"',
    ],
  ]);
});

test("Chosen, proposed beside an accepted ADR is reported with the label to use", () => {
  check(decisions(item(2, "Chosen, proposed (ADR 0040)", "0040")));
  expect(calls()).toEqual([
    [
      FILE,
      5,
      "Decision 2 says Chosen, proposed but every linked ADR is accepted",
      'change its label to "Decided"',
    ],
  ]);
});

test("Decided beside one accepted and one proposed ADR names only the proposed one", () => {
  check(decisions(item(3, "Decided", "0040", "0041")));
  expect(calls()).toEqual([
    [
      FILE,
      5,
      "Decision 3 says Decided but ADR 0041 is proposed",
      'change its label to "Chosen, proposed (ADR 0041)"',
    ],
  ]);
});

test("a superseded ADR is reported with its replacement in the fix", () => {
  check(decisions(item(4, "Decided", "0060")));
  expect(calls()).toEqual([
    [
      FILE,
      5,
      "Decision 4 links ADR 0060, which is superseded",
      "link ADR 0081, the ADR that supersedes it, and label the Decision by that ADR's status",
    ],
  ]);
});

test("Decided in prose outside the Decisions list is not reported", () => {
  const text = [
    "# Vision",
    "1. **Early.** Decided: before the list ([ADR 0037](decisions/0037-x.md))",
    "",
    decisions(item(1, "Chosen, proposed (ADR 0037)", "0037")),
    "",
    "## Later",
    "2. **After.** Decided: after the list ([ADR 0037](decisions/0037-x.md))",
  ].join("\n");
  expect(check(text)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a Decision linking an unknown ADR or no ADR is left to the link checks", () => {
  const text = decisions(
    item(1, "Decided", "9999"),
    "2. **Bare.** Decided: no link",
  );
  expect(check(text)).toEqual([]);
});

test("a file with no Decisions heading has no findings", () => {
  expect(check("# Vision\n\n1. **A.** Decided: x\n")).toEqual([]);
});
