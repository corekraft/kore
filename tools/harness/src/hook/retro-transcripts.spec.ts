// Finding the transcript directories of a repository and its worktrees.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeFileSystem } from "../runtime/index.js";
import {
  defaultDirs,
  readTranscripts,
  repoTranscriptDirs,
} from "./retro-transcripts.js";
import { FakeRunner } from "../runtime/runner-support.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const encode = (path: string) => path.replace(/[^a-zA-Z0-9]/g, "-");

function fakeProjects() {
  const home = mkdtempSync(join(tmpdir(), "kore-retro-home-"));
  temps.push(home);
  const projects = join(home, ".claude", "projects");
  mkdirSync(projects, { recursive: true });
  const session = (cwdPath: string, lines: object[], name = "s") => {
    const dir = join(projects, encode(cwdPath));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${name}.jsonl`),
      `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    );
    return dir;
  };
  return { home, projects, session };
}

const repo = {
  main: "/w/kore",
  worktrees: ["/w/kore", "/w/live/wt-a"],
  branches: ["fix/known"],
};
const dirsOf = (projects: string, checkouts = repo) =>
  repoTranscriptDirs(nodeFileSystem, projects, checkouts);

describe("repoTranscriptDirs", () => {
  it("covers the main checkout and live worktrees by name", async () => {
    const { projects, session } = fakeProjects();
    const main = session("/w/kore", [{ cwd: "/w/kore" }]);
    const live = session("/w/live/wt-a", [{ cwd: "/w/live/wt-a" }]);
    session("/w/other", [{ cwd: "/w/other", gitBranch: "feat/x" }]);
    expect(await dirsOf(projects)).toEqual(
      [live, main].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("finds a removed worktree whose recorded cwd is inside the repository", async () => {
    const { projects, session } = fakeProjects();
    const dir = session("/w/kore/.claude/worktrees/gone", [
      { cwd: "/w/kore/.claude/worktrees/gone" },
    ]);
    expect(await dirsOf(projects)).toEqual([dir]);
  });

  it("finds a removed worktree outside the repository by a known branch", async () => {
    const { projects, session } = fakeProjects();
    const dir = session("/j/tmp/wt-old", [
      { cwd: "/j/tmp/wt-old", gitBranch: "fix/known" },
    ]);
    session("/j/tmp/wt-foreign", [
      { cwd: "/j/tmp/wt-foreign", gitBranch: "fix/unknown" },
    ]);
    expect(await dirsOf(projects)).toEqual([dir]);
  });

  it("does not let the default branch claim another repository's sessions", async () => {
    const { projects, session } = fakeProjects();
    session("/elsewhere", [{ cwd: "/elsewhere", gitBranch: "main" }]);
    expect(
      await dirsOf(projects, { ...repo, branches: ["main", "fix/known"] }),
    ).toEqual([]);
  });

  it("finds a removed worktree on a deleted branch when its transcript names the main checkout", async () => {
    const { projects, session } = fakeProjects();
    const dir = session("/j/tmp/wt-gone", [
      { cwd: "/j/tmp/wt-gone", gitBranch: "fix/deleted" },
      { note: "read /w/kore/AGENTS.md" },
    ]);
    expect(await dirsOf(projects)).toEqual([dir]);
  });

  it("skips a foreign line, a null line and a directory with no transcripts", async () => {
    const { projects } = fakeProjects();
    const dir = join(projects, "foreign");
    mkdirSync(dir);
    writeFileSync(join(dir, "s.jsonl"), 'not json\nnull\n{"cwd":5}\n');
    mkdirSync(join(projects, "empty"));
    writeFileSync(join(projects, "a-file"), "x");
    expect(await dirsOf(projects)).toEqual([]);
  });

  it("yields no directories for a missing projects directory", async () => {
    expect(await dirsOf("/nonexistent-kore-projects")).toEqual([]);
  });
});

describe("defaultDirs", () => {
  const git = (responses: Record<string, string>, code = 0) =>
    new FakeRunner(
      Object.entries(responses).map(([verb, stdout]) => ({
        match: (_command: string, args: readonly string[]) => args[0] === verb,
        result: { code, stdout },
      })),
    );
  const dirs = (runner: FakeRunner, home: string) =>
    defaultDirs(nodeFileSystem, runner, "/w/kore/sub", home);

  it("asks git, from the repository root, for the worktrees and branches", async () => {
    const { home, session } = fakeProjects();
    const main = session("/w/kore", [{ cwd: "/w/kore" }]);
    const removed = session("/j/tmp/wt-old", [{ gitBranch: "fix/known" }]);
    session("/j/tmp/wt-foreign", [{ gitBranch: "fix/unknown" }]);
    const runner = git({
      worktree: "worktree /w/kore\nHEAD x\n\nworktree /w/live/wt-a\n",
      "for-each-ref": "main\norigin/fix/known\n\n",
      "rev-parse": "/w/kore/.git\n",
    });
    expect(await dirs(runner, home)).toEqual(
      [removed, main].sort((a, b) => a.localeCompare(b)),
    );
    expect(runner.calls.every((c) => c.options?.cwd === "/w/kore/sub")).toBe(
      true,
    );
  });

  it("takes the main checkout from the git directory when no worktree is listed", async () => {
    const { home, session } = fakeProjects();
    const main = session("/w/kore", [{ cwd: "/w/kore" }]);
    const runner = git({ "rev-parse": "/w/kore/.git\n" });
    expect(await dirs(runner, home)).toEqual([main]);
  });

  it("falls back to the repository root when git reports nothing", async () => {
    const { home, session } = fakeProjects();
    const sub = session("/w/kore/sub", [{ cwd: "/w/kore/sub" }]);
    const runner = git({ worktree: "x", "rev-parse": "x" }, 1);
    expect(await dirs(runner, home)).toEqual([sub]);
  });
});

describe("readTranscripts", () => {
  it("keeps the fuller copy of a session resumed in two directories, sorted by id", async () => {
    const { projects } = fakeProjects();
    const [a, b] = [join(projects, "a"), join(projects, "b")];
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "s2.jsonl"), '{"n":1}\n');
    writeFileSync(join(a, "s1.jsonl"), "short\n");
    writeFileSync(join(b, "s1.jsonl"), "a much longer copy\n");
    writeFileSync(join(b, "notes.txt"), "ignored");
    expect(await readTranscripts(nodeFileSystem, [a, b])).toEqual([
      { id: "s1", text: "a much longer copy\n" },
      { id: "s2", text: '{"n":1}\n' },
    ]);
  });
});
