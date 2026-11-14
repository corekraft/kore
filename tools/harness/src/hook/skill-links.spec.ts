// Skill links as a unit: which skills `linkProblems` checks, and the problem
// each broken link reports, over a typed fake file system. The real links on
// disk and the hook dispatcher are in integration/hook/skill-links.spec.ts.
// Plan: infra/plans/3-agent-harness.md (Step 9).

import { describe, expect, it, vi } from "vitest";
import { CommandError, type FileSystem } from "../runtime/index.js";
import { linkProblems } from "./skill-links.js";

const ROOT = "/repo";

/** A typed file system whose three reads the unit makes are mocks; a link that is not set up is missing. */
function fakeFs() {
  return {
    readdir: vi.fn<FileSystem["readdir"]>(),
    exists: vi.fn<FileSystem["exists"]>(),
    readlink: vi.fn<FileSystem["readlink"]>(() =>
      Promise.reject(fsError("ENOENT")),
    ),
  };
}

/** The fake as the file system the unit reads through; only the three reads are mocked, so the one assertion stands for the rest. */
function port(fake: ReturnType<typeof fakeFs>): FileSystem {
  const used: Pick<FileSystem, "readdir" | "exists" | "readlink"> = fake;
  return used as FileSystem;
}

const fsError = (code: string) => Object.assign(new Error(code), { code });

/** The repository's skills, each with a SKILL.md, plus whatever else sits in skills/. */
function skills(names: string[], others: string[] = []) {
  const fake = fakeFs();
  fake.readdir.mockResolvedValue([...names, ...others]);
  fake.exists.mockImplementation((path) =>
    Promise.resolve(
      names.some((name) => path === `${ROOT}/skills/${name}/SKILL.md`),
    ),
  );
  return fake;
}

/** Each link path mapped to its target, or to the error readlink rejects with. */
function linksAs(
  fake: ReturnType<typeof fakeFs>,
  table: Record<string, string | Error>,
) {
  fake.readlink.mockImplementation((path) => {
    const found = table[path.slice(ROOT.length + 1)];
    if (found === undefined) {
      return Promise.reject(fsError("ENOENT"));
    }
    return found instanceof Error
      ? Promise.reject(found)
      : Promise.resolve(found);
  });
}

describe("linkProblems: which skills it checks", () => {
  it("checks only the skills/ entries that hold a SKILL.md, in name order", async () => {
    const fake = skills(["tdd", "adr"], ["bin"]);
    const problems = await linkProblems(port(fake), ROOT);
    expect(problems).toEqual([
      ".claude/skills/adr is missing; link it to ../../skills/adr",
      ".claude/skills/tdd is missing; link it to ../../skills/tdd",
      ".codex/skills/adr is missing; link it to ../../skills/adr",
      ".codex/skills/tdd is missing; link it to ../../skills/tdd",
    ]);
    expect(fake.exists).toHaveBeenCalledWith(`${ROOT}/skills/bin/SKILL.md`);
  });

  it("reports nothing when skills/ holds no skill", async () => {
    const fake = skills([], ["bin"]);
    expect(await linkProblems(port(fake), ROOT)).toEqual([]);
    expect(fake.readlink).not.toHaveBeenCalled();
  });

  it("names the fix when skills/ does not exist", async () => {
    const fake = fakeFs();
    fake.readdir.mockRejectedValue(fsError("ENOENT"));
    await expect(linkProblems(port(fake), ROOT)).rejects.toThrow(
      new CommandError(
        "No skills directory at /repo/skills. Run from the repository, or set CLAUDE_PROJECT_DIR to its root.",
      ),
    );
  });

  it("rethrows a read fault that is not a missing skills/ directory", async () => {
    const fake = fakeFs();
    fake.readdir.mockRejectedValue(fsError("EACCES"));
    await expect(linkProblems(port(fake), ROOT)).rejects.toThrow("EACCES");
  });
});

describe("linkProblems: a correct link", () => {
  it("passes when each harness links each skill by its relative path", async () => {
    const fake = skills(["tdd"]);
    linksAs(fake, {
      ".claude/skills/tdd": "../../skills/tdd",
      ".codex/skills/tdd": "../../skills/tdd",
    });
    expect(await linkProblems(port(fake), ROOT)).toEqual([]);
  });
});

describe("linkProblems: a broken link", () => {
  it("reports a link by an absolute path, with the relative fix", async () => {
    const fake = skills(["adr"]);
    linksAs(fake, {
      ".claude/skills/adr": "../../skills/adr",
      ".codex/skills/adr": "/repo/skills/adr",
    });
    expect(await linkProblems(port(fake), ROOT)).toEqual([
      ".codex/skills/adr links to an absolute path; relink it to ../../skills/adr",
    ]);
  });

  it("reports a link to another skill, naming its target", async () => {
    const fake = skills(["tdd", "adr"]);
    linksAs(fake, {
      ".claude/skills/tdd": "../../skills/tdd",
      ".claude/skills/adr": "../../skills/adr",
      ".codex/skills/tdd": "../../skills/tdd",
      ".codex/skills/adr": "../../skills/tdd",
    });
    expect(await linkProblems(port(fake), ROOT)).toEqual([
      ".codex/skills/adr links to ../../skills/tdd; relink it to ../../skills/adr",
    ]);
  });

  it("reports a missing link", async () => {
    const fake = skills(["adr"]);
    linksAs(fake, { ".claude/skills/adr": "../../skills/adr" });
    expect(await linkProblems(port(fake), ROOT)).toEqual([
      ".codex/skills/adr is missing; link it to ../../skills/adr",
    ]);
  });

  it("reports a directory or file where a link belongs, as not a link", async () => {
    const fake = skills(["adr"]);
    linksAs(fake, {
      ".claude/skills/adr": "../../skills/adr",
      ".codex/skills/adr": fsError("EINVAL"),
    });
    expect(await linkProblems(port(fake), ROOT)).toEqual([
      ".codex/skills/adr is a directory or file, not a link; replace it with a link to ../../skills/adr",
    ]);
  });

  it("rethrows a readlink fault that is neither missing nor not-a-link", async () => {
    const fake = skills(["adr"]);
    linksAs(fake, { ".claude/skills/adr": fsError("EACCES") });
    await expect(linkProblems(port(fake), ROOT)).rejects.toThrow("EACCES");
  });
});
