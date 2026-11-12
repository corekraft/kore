import { describe, expect, it } from "vitest";
import type { CliDeps } from "../cli/index.js";
import { run } from "../cli/index.js";
import { FakeRunner } from "../runtime/runner-support.js";

type Files = Record<string, string>;

function skill(description: string, bodyLines: number, name = "x"): string {
  const body = Array.from({ length: bodyLines }, (_, i) => `line ${i + 1}`);
  return `---\nname: ${name}\ndescription: ${description}\n---\n${body.join("\n")}\n`;
}

const ROOT = "/repo";
const rel = (path: string) => path.replace(`${ROOT}/`, "");

function harness(
  files: Files,
  opts: { code?: string; error?: string } = {},
  missingSkills = false,
) {
  const dirs = Object.keys(files);
  const out: string[] = [];
  const err: string[] = [];
  const names = [
    ...new Set([
      ...dirs.map((p) => p.split("/")[1] ?? ""),
      ...Object.keys(files).map((p) => p.split("/")[1] ?? ""),
    ]),
  ];
  const deps: CliDeps = {
    runner: new FakeRunner(),
    clock: {
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      sleep: () => Promise.resolve(),
    },
    root: () => Promise.resolve(ROOT),
    env: {},
    cwd: ROOT,
    ids: { next: () => "id-1" },
    stdin: () => Promise.resolve(""),
    fs: {
      readFile: (path) =>
        rel(path) in files
          ? Promise.resolve(files[rel(path)] ?? "")
          : Promise.reject(new Error(`ENOENT ${path}`)),
      writeFile: () => Promise.resolve(),
      createFile: () => Promise.resolve(),
      appendFile: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      exists: (path) => Promise.resolve(rel(path) in files),
      readdir: (path) =>
        rel(path) === "skills" && !missingSkills
          ? Promise.resolve(names)
          : Promise.reject(
              Object.assign(new Error(opts.error ?? "ENOENT"), {
                code: opts.code ?? "ENOENT",
              }),
            ),
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  return { deps, out: () => out.join(""), err: () => err.join("") };
}

interface Row {
  name: string;
  directory: string;
  descriptionChars: number;
  bodyLines: number;
  verdict: string;
  over?: string[];
  reason?: string;
}
interface Report {
  skills: Row[];
  summary: Record<string, number>;
}

async function audit(files: Files, ...flags: string[]) {
  const h = harness(files);
  const code = await run(["skill", "audit", "--json", ...flags], h.deps);
  return { code, h, report: JSON.parse(h.out()) as Report };
}

const ok = skill("short", 3);

describe("skill audit verdicts", () => {
  it("passes a skill within both budgets", async () => {
    const { code, report } = await audit({ "skills/a/SKILL.md": ok });
    expect(code).toBe(0);
    expect(report.skills).toEqual([
      {
        name: "x",
        directory: "a",
        descriptionChars: 5,
        bodyLines: 3,
        verdict: "ok",
      },
    ]);
  });

  it("allows exactly 200 description characters and 25 body lines", async () => {
    const { report } = await audit({
      "skills/a/SKILL.md": skill("d".repeat(200), 25),
    });
    expect(report.skills[0]?.verdict).toBe("ok");
  });

  it("flags a description over 200 characters", async () => {
    const { report } = await audit({
      "skills/a/SKILL.md": skill("d".repeat(201), 3),
    });
    expect(report.skills[0]).toMatchObject({
      verdict: "over-budget",
      over: ["description"],
      descriptionChars: 201,
    });
  });

  it("flags a body over 25 lines", async () => {
    const { report } = await audit({ "skills/a/SKILL.md": skill("d", 26) });
    expect(report.skills[0]).toMatchObject({
      verdict: "over-budget",
      over: ["body"],
      bodyLines: 26,
    });
  });

  it("names both budgets when both are exceeded", async () => {
    const { report } = await audit({
      "skills/a/SKILL.md": skill("d".repeat(300), 40),
    });
    expect(report.skills[0]).toMatchObject({
      verdict: "over-budget",
      over: ["description", "body"],
    });
  });
});

describe("skill audit malformed and listing", () => {
  it.each([
    ["no frontmatter", "# just a body\n", "missing frontmatter"],
    [
      "unterminated",
      "---\nname: x\ndescription: d\n",
      "unterminated frontmatter",
    ],
    ["no description", "---\nname: x\n---\nbody\n", "missing description"],
    ["no name", "---\ndescription: d\n---\nbody\n", "missing name"],
    [
      "block scalar description",
      "---\nname: x\ndescription: >\n  long\n---\nbody\n",
      "multi-line description",
    ],
  ])("reports %s as invalid instead of crashing", async (_, text, reason) => {
    const { code, report } = await audit({
      "skills/a/SKILL.md": text,
      "skills/b/SKILL.md": ok,
    });
    expect(code).toBe(0);
    expect(report.skills).toHaveLength(2);
    expect(report.skills[0]).toMatchObject({ verdict: "invalid", reason });
    expect(report.skills[1]?.verdict).toBe("ok");
  });

  it("sorts by name and lists every skill, skipping directories without SKILL.md", async () => {
    const { report } = await audit({
      "skills/zeta/SKILL.md": skill("d", 1, "zeta"),
      "skills/alpha/SKILL.md": skill("d", 1, "alpha"),
      "skills/mid/SKILL.md": skill("d".repeat(250), 1, "mid"),
      "skills/bin/harness.mjs": "// bundle",
    });
    expect(report.skills.map((s) => s.name)).toEqual(["alpha", "mid", "zeta"]);
    expect(report.skills.map((s) => s.directory)).not.toContain("bin");
    expect(report.summary).toEqual({ ok: 2, "over-budget": 1, invalid: 0 });
  });
});

describe("skill audit report shape", () => {
  it("names the directory on every row, valid or invalid", async () => {
    const { report } = await audit({
      "skills/a/SKILL.md": skill("d", 1, "renamed"),
      "skills/b/SKILL.md": "---\nname: bee\n---\nbody\n",
      "skills/c/SKILL.md": "oops",
    });
    expect(report.skills.map((s) => [s.name, s.directory])).toEqual([
      ["b", "b"],
      ["c", "c"],
      ["renamed", "a"],
    ]);
  });

  it("exits zero by default even when a skill is over budget", async () => {
    const { code } = await audit({ "skills/a/SKILL.md": skill("d", 99) });
    expect(code).toBe(0);
  });

  it("exits non-zero under --strict for an over-budget skill", async () => {
    const { code, report } = await audit(
      { "skills/a/SKILL.md": skill("d", 99) },
      "--strict",
    );
    expect(code).toBe(1);
    expect(report.skills).toHaveLength(1);
  });

  it("exits non-zero under --strict for an invalid skill", async () => {
    const { code } = await audit({ "skills/a/SKILL.md": "oops" }, "--strict");
    expect(code).toBe(1);
  });

  it("exits zero under --strict when every skill is ok", async () => {
    const { code } = await audit({ "skills/a/SKILL.md": ok }, "--strict");
    expect(code).toBe(0);
  });

  it("prints a human table with verdicts and summary counts", async () => {
    const h = harness({ "skills/a/SKILL.md": skill("d", 30, "a") });
    expect(await run(["skill", "audit"], h.deps)).toBe(0);
    expect(h.out()).toMatch(/^NAME {2}DESC {2}BODY {2}VERDICT$/m);
    expect(h.out()).toMatch(/^a {8}1 {4}30 {2}over-budget \(body\)$/m);
    expect(h.out()).toMatch(/^0 ok, 1 over-budget, 0 invalid$/m);
  });

  it("fails with a named error when the skills directory is missing", async () => {
    const h = harness({}, {}, true);
    expect(await run(["skill", "audit", "--json"], h.deps)).toBe(1);
    const first = JSON.parse(h.err().split("\n")[0] ?? "") as { error: string };
    expect(first.error).toContain("/repo/skills");
    expect(first.error).toContain("CLAUDE_PROJECT_DIR");
    expect(h.err()).not.toContain("    at ");
  });

  it("rethrows unexpected read errors instead of masking them", async () => {
    const h = harness({}, { code: "EACCES", error: "denied" }, true);
    await expect(run(["skill", "audit"], h.deps)).rejects.toThrow("denied");
  });

  it("rejects --strict on commands that do not take it", async () => {
    const h = harness({});
    expect(await run(["harness", "version", "--strict"], h.deps)).toBe(2);
    expect(h.err()).toContain('Unknown flag "--strict"');
  });
});
