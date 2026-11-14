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

// vision.html: its Decision badges and "Last verified" date must match vision.md.
const HTML_FILE = "docs/vision.html";
const md = (date: string, ...items: string[]) =>
  `---\nlast-verified: ${date}\n---\n${decisions(...items)}`;
const MD_ITEMS = [
  item(1, "Chosen, proposed (ADR 0037)", "0037"),
  item(2, "Decided", "0040"),
];
const html = (date: string, ...badges: string[]) =>
  [
    `<span>Status: active · Last verified ${date}</span>`,
    '<h2 id="questions">Decisions</h2>',
    '<ol class="questions">',
    ...badges.map((b) => `<li><a class="pill">${b}</a></li>`),
    "</ol>",
  ].join("\n");
const FIRST = "Chosen, proposed · ADR 0037";
const SECOND = "Decided · ADR 0040";
const drift = (htmlText: string | null) =>
  new VisionCheck((adr) => STATES[adr] ?? null).check(
    md("2026-11-14", ...MD_ITEMS),
    htmlText,
  );

test("matching vision.md and vision.html have no drift findings", () => {
  expect(drift(html("2026-11-14", FIRST, SECOND))).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("an absent vision.html is not checked", () => {
  expect(drift(null)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a badge with a different label is reported with the badge to use", () => {
  expect(drift(html("2026-11-14", "Decided · ADR 0037", SECOND))).toEqual([
    PROBLEM,
  ]);
  expect(calls()).toEqual([
    [
      HTML_FILE,
      4,
      'Decision 1 badge says "Decided" but vision.md says "Chosen, proposed"',
      'change the badge to "Chosen, proposed · ADR 0037"',
    ],
  ]);
});

test("a badge with a different ADR number is reported with the badge to use", () => {
  drift(html("2026-11-14", FIRST, "Decided · ADR 0041"));
  expect(calls()).toEqual([
    [
      HTML_FILE,
      5,
      "Decision 2 badge says ADR 0041 but vision.md says ADR 0040",
      'change the badge to "Decided · ADR 0040"',
    ],
  ]);
});

test("a decision missing from vision.html is reported with the badge to add", () => {
  drift(html("2026-11-14", FIRST));
  expect(calls()).toEqual([
    [
      HTML_FILE,
      3,
      "Decision 2 is missing from vision.html",
      'add the badge "Decided · ADR 0040" for it',
    ],
  ]);
});

test("an extra decision in vision.html is reported with its line", () => {
  drift(html("2026-11-14", FIRST, SECOND, "Decided · ADR 0099"));
  expect(calls()).toEqual([
    [
      HTML_FILE,
      6,
      'vision.html has the badge "Decided · ADR 0099", which vision.md does not list',
      "remove it, or add the Decision to vision.md",
    ],
  ]);
});

test("decisions out of order are reported with the badge belonging at that place", () => {
  drift(html("2026-11-14", SECOND, FIRST));
  expect(calls()).toEqual([
    [
      HTML_FILE,
      4,
      "Decision 1 is out of order in vision.html",
      'put the badge "Chosen, proposed · ADR 0037" here',
    ],
    [
      HTML_FILE,
      5,
      "Decision 2 is out of order in vision.html",
      'put the badge "Decided · ADR 0040" here',
    ],
  ]);
});

test("mismatched last-verified dates are reported with the date to use", () => {
  drift(html("2026-11-13", FIRST, SECOND));
  expect(calls()).toEqual([
    [
      HTML_FILE,
      1,
      "vision.html says Last verified 2026-11-13 but vision.md says 2026-11-14",
      "change the header date to 2026-11-14",
    ],
  ]);
});

test("Decided in, in vision.html body text, is not reported", () => {
  const body = `${html("2026-11-14", FIRST, SECOND)}\n<p>Decided in <a>ADR 0046</a>.</p>`;
  expect(drift(body)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});
