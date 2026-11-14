// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { describe, expect, it } from "vitest";
import {
  auditSkill,
  auditSkills,
  renderReport,
  type AuditReport,
} from "./audit.js";
import { fakeFileSystem } from "./skill-support.js";

function skill(description: string, bodyLines: number, name = "x"): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `line ${i + 1}`);
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body.join("\n")}\n`;
}

describe("auditSkill budgets", () => {
  it("passes a skill within both budgets, with no over-budget list", () => {
    expect(auditSkill("a", skill("short", 3))).toEqual({
      name: "x",
      directory: "a",
      descriptionChars: 5,
      bodyLines: 3,
      verdict: "ok",
    });
  });

  it("allows exactly 200 description characters and 25 body lines", () => {
    expect(auditSkill("a", skill("d".repeat(200), 25)).verdict).toBe("ok");
  });

  it("flags a description one character over 200", () => {
    expect(auditSkill("a", skill("d".repeat(201), 3))).toMatchObject({
      verdict: "over-budget",
      over: ["description"],
      descriptionChars: 201,
    });
  });

  it("flags a body one line over 25", () => {
    expect(auditSkill("a", skill("d", 26))).toMatchObject({
      verdict: "over-budget",
      over: ["body"],
      bodyLines: 26,
    });
  });

  it("names description before body when both are over", () => {
    expect(auditSkill("a", skill("d".repeat(300), 40))).toMatchObject({
      verdict: "over-budget",
      over: ["description", "body"],
    });
  });

  it("counts a skill with no body as zero lines, not one", () => {
    expect(
      auditSkill("a", "---\nname: x\ndescription: d\n---\n"),
    ).toMatchObject({ bodyLines: 0, verdict: "ok" });
  });
});

describe("auditSkill reading", () => {
  it("strips matching quotes from the name and the description", () => {
    expect(
      auditSkill("a", `---\nname: "quoted"\ndescription: 'dd'\n---\nbody\n`),
    ).toMatchObject({ name: "quoted", descriptionChars: 2 });
  });

  it("reads CRLF line endings the same as LF", () => {
    expect(
      auditSkill("a", "---\r\nname: x\r\ndescription: d\r\n---\r\nline 1\r\n"),
    ).toMatchObject({ name: "x", descriptionChars: 1, bodyLines: 1 });
  });

  it.each([
    ["no frontmatter", "# just a body\n", "missing frontmatter"],
    [
      "unterminated",
      "---\nname: x\ndescription: d\n",
      "unterminated frontmatter",
    ],
    ["no description", "---\nname: x\n---\nbody\n", "missing description"],
    [
      "an empty description",
      "---\nname: x\ndescription:\n---\nbody\n",
      "missing description",
    ],
    ["no name", "---\ndescription: d\n---\nbody\n", "missing name"],
    [
      "a folded block description",
      "---\nname: x\ndescription: >\n  long\n---\n",
      "multi-line description",
    ],
    [
      "a literal block description",
      "---\nname: x\ndescription: |-\n  long\n---\n",
      "multi-line description",
    ],
  ])("reports %s as invalid instead of throwing", (_, text, reason) => {
    expect(auditSkill("a", text)).toEqual({
      name: "a",
      directory: "a",
      descriptionChars: 0,
      bodyLines: 0,
      verdict: "invalid",
      reason,
    });
  });
});

describe("auditSkills listing", () => {
  it("lists each directory with a SKILL.md, sorted by name, and skips the rest", async () => {
    const report = await auditSkills(
      fakeFileSystem({
        "skills/zeta/SKILL.md": skill("d", 1, "zeta"),
        "skills/alpha/SKILL.md": skill("d", 1, "alpha"),
        "skills/mid/SKILL.md": skill("d".repeat(250), 1, "mid"),
        "skills/bin/harness.mjs": "// bundle",
      }),
      "skills",
    );
    expect(report.skills.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
    expect(report.skills.map((s) => s.directory)).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("counts each verdict once in the summary", async () => {
    const report = await auditSkills(
      fakeFileSystem({
        "skills/a/SKILL.md": skill("d", 1, "a"),
        "skills/b/SKILL.md": skill("d".repeat(250), 1, "b"),
        "skills/c/SKILL.md": "oops",
      }),
      "skills",
    );
    expect(report.summary).toEqual({ ok: 1, "over-budget": 1, invalid: 1 });
  });

  it("sorts names in English locale order, not by code point", async () => {
    const report = await auditSkills(
      fakeFileSystem({
        "skills/b/SKILL.md": skill("d", 1, "Beta"),
        "skills/a/SKILL.md": skill("d", 1, "alpha"),
      }),
      "skills",
    );
    expect(report.skills.map((s) => s.name)).toEqual(["alpha", "Beta"]);
  });

  it("reads only SKILL.md under each directory", async () => {
    const report = await auditSkills(
      fakeFileSystem({
        "skills/a/SKILL.md": skill("d", 1, "a"),
        "skills/a/notes.md": "not a skill",
      }),
      "skills",
    );
    expect(report.skills).toHaveLength(1);
  });

  it("rejects with the file system error when the skills directory is missing", async () => {
    await expect(
      auditSkills(fakeFileSystem({}), "skills"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns an empty report when no directory holds a SKILL.md", async () => {
    const report = await auditSkills(
      fakeFileSystem({ "skills/bin/harness.mjs": "// bundle" }),
      "skills",
    );
    expect(report).toEqual({
      skills: [],
      summary: { ok: 0, "over-budget": 0, invalid: 0 },
    });
  });
});

describe("renderReport", () => {
  const report: AuditReport = {
    skills: [
      {
        name: "a",
        directory: "a",
        descriptionChars: 1,
        bodyLines: 30,
        verdict: "over-budget",
        over: ["body"],
      },
      {
        name: "longer",
        directory: "longer",
        descriptionChars: 12,
        bodyLines: 3,
        verdict: "ok",
      },
      {
        name: "bad",
        directory: "bad",
        descriptionChars: 0,
        bodyLines: 0,
        verdict: "invalid",
        reason: "missing name",
      },
    ],
    summary: { ok: 1, "over-budget": 1, invalid: 1 },
  };

  it("prints a header, one row per skill with its verdict, and the summary", () => {
    expect(renderReport(report)).toBe(
      [
        "NAME    DESC  BODY  VERDICT",
        "a          1    30  over-budget (body)",
        "longer    12     3  ok",
        "bad        0     0  invalid (missing name)",
        "",
        "1 ok, 1 over-budget, 1 invalid",
        "",
      ].join("\n"),
    );
  });

  it("pads the name column to the longest name, and never below four characters", () => {
    const empty: AuditReport = {
      skills: [],
      summary: { ok: 0, "over-budget": 0, invalid: 0 },
    };
    expect(renderReport(empty).split("\n")[0]).toBe(
      "NAME  DESC  BODY  VERDICT",
    );
  });
});
