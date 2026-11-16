import { describe, expect, it } from "vitest";
import { authorCheck } from "./author-check.js";
import type { ItemVerdict } from "./checks.js";
import type { Report } from "./precheck.js";

const item = (
  name: string,
  result: ItemVerdict["result"],
  mode: ItemVerdict["mode"] = "enforce",
  detail?: string,
): ItemVerdict => ({
  item: name,
  rule: `judge-${name}`,
  mode,
  result,
  ...(detail === undefined ? {} : { detail }),
});

const PASSING: ItemVerdict[] = [
  item("ci", "pass"),
  item("scan", "pass"),
  item("coverage", "pass"),
  item("principles-review", "pass"),
  item("pattern-match", "pass"),
];

/** The passing checklist with one item replaced by `next`. */
const withItem = (next: ItemVerdict): ItemVerdict[] => [
  ...PASSING.filter((i) => i.item !== next.item),
  next,
];

const report = (
  checklist: ItemVerdict[],
  declaration: Pick<Report["declaration"], "ok"> &
    Partial<Pick<Report["declaration"], "reason">> = { ok: true },
): Pick<Report, "pr" | "declaration" | "checklist"> => ({
  pr: 12,
  declaration,
  checklist,
});

describe("authorCheck reports a change the judge can take as clean", () => {
  it("has no failures and nothing pending when every enforce item passes", () => {
    expect(authorCheck(report(PASSING))).toStrictEqual({
      pr: 12,
      ok: true,
      failures: [],
      pending: [],
    });
  });
});

describe("authorCheck lists work the writer does not own as pending, not as a failure", () => {
  it("names CI still running as pending, and exits clean with nothing to fix", () => {
    expect(authorCheck(report(withItem(item("ci", "pending"))))).toStrictEqual({
      pr: 12,
      ok: true,
      failures: [],
      pending: ["ci"],
    });
  });

  it("names a review not yet posted as pending, the same as CI", () => {
    expect(
      authorCheck(report(withItem(item("principles-review", "missing")))),
    ).toStrictEqual({
      pr: 12,
      ok: true,
      failures: [],
      pending: ["principles-review"],
    });
  });

  it("treats a review that does not cover the head as pending, not as a failure", () => {
    expect(
      authorCheck(report(withItem(item("principles-review", "unverified")))),
    ).toMatchObject({ ok: true, failures: [], pending: ["principles-review"] });
  });
});

describe("authorCheck fails a change on a failed check, with its category", () => {
  it("counts a failed check as failed-check, with its detail", () => {
    expect(
      authorCheck(
        report(withItem(item("scan", "fail", "enforce", "scan: failure"))),
      ),
    ).toStrictEqual({
      pr: 12,
      ok: false,
      failures: [
        { category: "failed-check", item: "scan", detail: "scan: failure" },
      ],
      pending: [],
    });
  });

  it("counts a pattern mismatch as pattern-mismatch", () => {
    expect(
      authorCheck(
        report(
          withItem(
            item("pattern-match", "fail", "enforce", "adds a new route"),
          ),
        ),
      ),
    ).toStrictEqual({
      pr: 12,
      ok: false,
      failures: [
        {
          category: "pattern-mismatch",
          item: "pattern-match",
          detail: "adds a new route",
        },
      ],
      pending: [],
    });
  });

  it("counts an expand step with no proof as missing-proof", () => {
    const checklist = [
      ...PASSING,
      item("expand-step", "fail", "enforce", "no expand step proof"),
    ];
    expect(authorCheck(report(checklist))).toMatchObject({
      ok: false,
      failures: [
        {
          category: "missing-proof",
          item: "expand-step",
          detail: "no expand step proof",
        },
      ],
    });
  });

  it("counts a guardrail that lands in enforce without activation as rule-break", () => {
    const checklist = [
      ...PASSING,
      item("guardrail-activation", "fail", "enforce", "x has no activation"),
    ];
    expect(authorCheck(report(checklist))).toMatchObject({
      ok: false,
      failures: [{ category: "rule-break", item: "guardrail-activation" }],
    });
  });
});

describe("authorCheck reads an invalid declaration alone, and keeps a failure beside a pending item", () => {
  it("counts an invalid declaration alone, with nothing else read or pending", () => {
    expect(
      authorCheck(
        report([], {
          ok: false,
          reason: "no valid safety pattern is declared.",
        }),
      ),
    ).toStrictEqual({
      pr: 12,
      ok: false,
      failures: [
        {
          category: "declaration",
          item: "declaration",
          detail: "no valid safety pattern is declared.",
        },
      ],
      pending: [],
    });
  });

  it("lists a failure beside a pending item, and both are reported", () => {
    const checklist = [
      ...withItem(item("scan", "fail", "enforce", "scan: failure")),
    ].filter((i) => i.item !== "ci");
    checklist.push(item("ci", "pending"));
    expect(authorCheck(report(checklist))).toStrictEqual({
      pr: 12,
      ok: false,
      failures: [
        { category: "failed-check", item: "scan", detail: "scan: failure" },
      ],
      pending: ["ci"],
    });
  });
});

describe("authorCheck never counts an audit item, which the judge only reports", () => {
  it("leaves a failing or pending audit item as neither a failure nor pending", () => {
    const checklist = [
      ...PASSING,
      item("coverage", "fail", "audit", "coverage: failure"),
      item("guardrail-activation", "pending", "audit"),
    ];
    expect(authorCheck(report(checklist))).toStrictEqual({
      pr: 12,
      ok: true,
      failures: [],
      pending: [],
    });
  });
});
