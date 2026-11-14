// Docs: infra/plans/14-test-tiers.md#step-3-convert-everything-else
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandError } from "../runtime/index.js";
import { auditSkills, renderReport, type AuditReport } from "./audit.js";
import { skill, skillAudit } from "./index.js";
import { errno, fakeDeps, fakeFileSystem } from "./skill-support.js";

vi.mock("./audit.js");
vi.mock("node:path");

const ROOT = "/repo";
const SKILLS = "/repo/skills";

const passing: AuditReport = {
  skills: [],
  summary: { ok: 1, "over-budget": 0, invalid: 0 },
};
const overBudget: AuditReport = {
  skills: [
    {
      name: "a",
      directory: "a",
      descriptionChars: 1,
      bodyLines: 30,
      verdict: "over-budget",
      over: ["body"],
    },
  ],
  summary: { ok: 0, "over-budget": 1, invalid: 0 },
};
const invalid: AuditReport = {
  skills: [
    {
      name: "b",
      directory: "b",
      descriptionChars: 0,
      bodyLines: 0,
      verdict: "invalid",
      reason: "missing name",
    },
  ],
  summary: { ok: 0, "over-budget": 0, invalid: 1 },
};

function audit() {
  const command = skill["audit"];
  if (command === undefined) {
    throw new Error("the skill record has no audit command");
  }
  return command;
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(renderReport).mockReturnValue("TABLE\n");
});

describe("skillAudit", () => {
  it("audits the skills directory under the root and returns the table", async () => {
    const fs = fakeFileSystem();
    vi.mocked(auditSkills).mockResolvedValue(passing);
    expect(await skillAudit(fs, ROOT)).toEqual({
      text: "TABLE\n",
      failing: false,
    });
    expect(auditSkills).toHaveBeenCalledWith(fs, SKILLS);
    expect(renderReport).toHaveBeenCalledWith(passing);
  });

  it.each([
    ["an over-budget skill", overBudget],
    ["an invalid skill", invalid],
  ])("reports failing for %s", async (_, report) => {
    vi.mocked(auditSkills).mockResolvedValue(report);
    expect((await skillAudit(fakeFileSystem(), ROOT)).failing).toBe(true);
  });

  it("names the skills directory when it is missing", async () => {
    vi.mocked(auditSkills).mockRejectedValue(errno("ENOENT"));
    await expect(skillAudit(fakeFileSystem(), ROOT)).rejects.toThrow(
      new CommandError(
        `No skills directory at ${SKILLS}. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.`,
      ),
    );
  });

  it("rethrows any other read error instead of masking it", async () => {
    const denied = errno("EACCES");
    vi.mocked(auditSkills).mockRejectedValue(denied);
    await expect(skillAudit(fakeFileSystem(), ROOT)).rejects.toBe(denied);
  });
});

describe("skill audit command", () => {
  it("prints the report as one line of JSON with --json", async () => {
    const { deps, out } = fakeDeps();
    vi.mocked(auditSkills).mockResolvedValue(overBudget);
    expect(await audit().run({ json: true, options: {}, deps })).toBe(0);
    expect(out()).toBe(`${JSON.stringify(overBudget)}\n`);
    expect(renderReport).not.toHaveBeenCalled();
  });

  it("prints the table for a person without --json", async () => {
    const { deps, out } = fakeDeps();
    vi.mocked(auditSkills).mockResolvedValue(passing);
    expect(await audit().run({ json: false, options: {}, deps })).toBe(0);
    expect(out()).toBe("TABLE\n");
  });

  it("exits zero by default even when a skill is over budget", async () => {
    const { deps } = fakeDeps();
    vi.mocked(auditSkills).mockResolvedValue(overBudget);
    expect(await audit().run({ json: false, options: {}, deps })).toBe(0);
  });

  it.each([
    ["an over-budget skill", overBudget],
    ["an invalid skill", invalid],
  ])("exits one under --strict for %s", async (_, report) => {
    const { deps } = fakeDeps();
    vi.mocked(auditSkills).mockResolvedValue(report);
    const code = await audit().run({
      json: false,
      options: { strict: true },
      deps,
    });
    expect(code).toBe(1);
  });

  it("exits zero under --strict when every skill is ok", async () => {
    const { deps } = fakeDeps();
    vi.mocked(auditSkills).mockResolvedValue(passing);
    const code = await audit().run({
      json: false,
      options: { strict: true },
      deps,
    });
    expect(code).toBe(0);
  });

  it("reads the skills under the repository root the deps resolve", async () => {
    const { deps } = fakeDeps({}, "/elsewhere");
    vi.mocked(auditSkills).mockResolvedValue(passing);
    await audit().run({ json: false, options: {}, deps });
    expect(auditSkills).toHaveBeenCalledWith(deps.fs, "/elsewhere/skills");
  });
});
