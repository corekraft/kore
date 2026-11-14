// Finding the transcript directories of a repository and its worktrees, and
// reading them, as a unit: the file system and the process runner are typed
// mocks over a small tree. Real directories and real git are in
// integration/hook/retro-transcripts.spec.ts.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { describe, expect, it, vi } from "vitest";
import type { FileSystem, RunResult, Runner } from "../runtime/index.js";
import {
  defaultDirs,
  readTranscripts,
  repoTranscriptDirs,
} from "./retro-transcripts.js";

/** A small file tree: directories with their entries, and the heads and texts of files. */
interface Tree {
  dirs: Record<string, string[]>;
  heads?: Record<string, string>;
  files?: Record<string, string>;
}

const PROJECTS = "/home/.claude/projects";
const notFound = (path: string) =>
  Promise.reject(
    Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" }),
  );

/** A typed file system over a tree; only the four reads the unit makes are mocks. */
function fakeFs(tree: Tree) {
  return {
    readdir: vi.fn<FileSystem["readdir"]>((path) =>
      tree.dirs[path] ? Promise.resolve(tree.dirs[path]) : notFound(path),
    ),
    isDirectory: vi.fn<FileSystem["isDirectory"]>((path) =>
      Promise.resolve(path in tree.dirs),
    ),
    readHead: vi.fn<FileSystem["readHead"]>((path) =>
      tree.heads?.[path] !== undefined
        ? Promise.resolve(tree.heads[path])
        : notFound(path),
    ),
    readFile: vi.fn<FileSystem["readFile"]>((path) =>
      tree.files?.[path] !== undefined
        ? Promise.resolve(tree.files[path])
        : notFound(path),
    ),
  };
}

/** The fake as the file system the unit reads through; the four reads are mocks, so the one assertion stands for the rest. */
function port(fake: ReturnType<typeof fakeFs>): FileSystem {
  const used: Pick<
    FileSystem,
    "readdir" | "isDirectory" | "readHead" | "readFile"
  > = fake;
  return used as FileSystem;
}

/** A process runner whose answer depends on the git verb it is asked. */
function gitRunner(answers: Record<string, string>, code = 0) {
  const run = vi.fn<Runner["run"]>((_command, args) =>
    Promise.resolve<RunResult>({
      code,
      stdout: answers[args[0] ?? ""] ?? "",
      stderr: "",
    }),
  );
  const runner: Runner = { run };
  return { runner, run };
}

const repo = {
  main: "/w/kore",
  worktrees: ["/w/kore", "/w/live/wt-a"],
  branches: ["fix/known"],
};

/** A transcript head as JSONL lines. */
const head = (...events: object[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

describe("repoTranscriptDirs: directories that name a checkout", () => {
  it("covers the main checkout and live worktrees by the name they encode", async () => {
    const fs = fakeFs({
      dirs: {
        [PROJECTS]: ["-w-kore", "-w-live-wt-a", "-w-other"],
        [`${PROJECTS}/-w-kore`]: [],
        [`${PROJECTS}/-w-live-wt-a`]: [],
        [`${PROJECTS}/-w-other`]: ["s.jsonl"],
      },
      heads: {
        [`${PROJECTS}/-w-other/s.jsonl`]: head({
          cwd: "/w/other",
          gitBranch: "feat/x",
        }),
      },
    });
    expect(await repoTranscriptDirs(port(fs), PROJECTS, repo)).toEqual([
      `${PROJECTS}/-w-kore`,
      `${PROJECTS}/-w-live-wt-a`,
    ]);
  });
});

describe("repoTranscriptDirs: directories that prove membership", () => {
  const one = (name: string, text: string) => ({
    dirs: { [PROJECTS]: [name], [`${PROJECTS}/${name}`]: ["s.jsonl"] },
    heads: { [`${PROJECTS}/${name}/s.jsonl`]: text },
  });

  it("finds a removed worktree whose recorded cwd is inside the repository", async () => {
    const fs = fakeFs(
      one("gone", head({ cwd: "/w/kore/.claude/worktrees/gone" })),
    );
    expect(await repoTranscriptDirs(port(fs), PROJECTS, repo)).toEqual([
      `${PROJECTS}/gone`,
    ]);
  });

  it("finds a removed worktree outside the repository by a known branch, not an unknown one", async () => {
    const fs = fakeFs({
      dirs: {
        [PROJECTS]: ["wt-old", "wt-foreign"],
        [`${PROJECTS}/wt-old`]: ["s.jsonl"],
        [`${PROJECTS}/wt-foreign`]: ["s.jsonl"],
      },
      heads: {
        [`${PROJECTS}/wt-old/s.jsonl`]: head({
          cwd: "/j/tmp/wt-old",
          gitBranch: "fix/known",
        }),
        [`${PROJECTS}/wt-foreign/s.jsonl`]: head({
          cwd: "/j/tmp/wt-foreign",
          gitBranch: "fix/unknown",
        }),
      },
    });
    expect(await repoTranscriptDirs(port(fs), PROJECTS, repo)).toEqual([
      `${PROJECTS}/wt-old`,
    ]);
  });

  it("does not let the default branch claim another repository's sessions", async () => {
    const fs = fakeFs(
      one("elsewhere", head({ cwd: "/elsewhere", gitBranch: "main" })),
    );
    expect(
      await repoTranscriptDirs(port(fs), PROJECTS, {
        ...repo,
        branches: ["main", "fix/known"],
      }),
    ).toEqual([]);
  });

  it("finds a removed worktree on a deleted branch when its transcript names the main checkout", async () => {
    const fs = fakeFs(
      one(
        "wt-gone",
        head(
          { cwd: "/j/tmp/wt-gone", gitBranch: "fix/deleted" },
          { note: "read /w/kore/AGENTS.md" },
        ),
      ),
    );
    expect(await repoTranscriptDirs(port(fs), PROJECTS, repo)).toEqual([
      `${PROJECTS}/wt-gone`,
    ]);
  });
});

describe("repoTranscriptDirs: what proves nothing", () => {
  it("skips a foreign line, a null line and a cwd that is not a string", async () => {
    const fs = fakeFs({
      dirs: {
        [PROJECTS]: ["foreign"],
        [`${PROJECTS}/foreign`]: ["s.jsonl"],
      },
      heads: { [`${PROJECTS}/foreign/s.jsonl`]: 'not json\nnull\n{"cwd":5}\n' },
    });
    expect(await repoTranscriptDirs(port(fs), PROJECTS, repo)).toEqual([]);
  });

  it("skips a directory with no transcripts, and a transcript it cannot read", async () => {
    const fs = fakeFs({
      dirs: {
        [PROJECTS]: ["empty", "unreadable"],
        [`${PROJECTS}/empty`]: [],
        [`${PROJECTS}/unreadable`]: ["s.jsonl"],
      },
    });
    expect(await repoTranscriptDirs(port(fs), PROJECTS, repo)).toEqual([]);
    expect(fs.readHead).toHaveBeenCalledWith(
      `${PROJECTS}/unreadable/s.jsonl`,
      256 * 1024,
    );
  });

  it("yields no directories when the projects directory is missing", async () => {
    const fs = fakeFs({ dirs: {} });
    expect(await repoTranscriptDirs(port(fs), PROJECTS, repo)).toEqual([]);
  });
});

describe("defaultDirs: what git reports", () => {
  const home = "/home";
  const dirs = (fs: ReturnType<typeof fakeFs>, runner: Runner) =>
    defaultDirs(port(fs), runner, "/w/kore/sub", home);

  it("asks git from the given root for the worktrees and branches, then finds the directories", async () => {
    const fs = fakeFs({
      dirs: {
        [PROJECTS]: ["-w-kore", "wt-old"],
        [`${PROJECTS}/-w-kore`]: [],
        [`${PROJECTS}/wt-old`]: ["s.jsonl"],
      },
      heads: {
        [`${PROJECTS}/wt-old/s.jsonl`]: head({ gitBranch: "fix/known" }),
      },
    });
    const { runner, run } = gitRunner({
      worktree: "worktree /w/kore\nHEAD x\n\nworktree /w/live/wt-a\n",
      "for-each-ref": "main\norigin/fix/known\n\n",
      "rev-parse": "/w/kore/.git\n",
    });
    expect(await dirs(fs, runner)).toEqual([
      `${PROJECTS}/-w-kore`,
      `${PROJECTS}/wt-old`,
    ]);
    expect(
      run.mock.calls.every(([, , options]) => options?.cwd === "/w/kore/sub"),
    ).toBe(true);
  });

  it("takes the main checkout from the git directory when no worktree is listed", async () => {
    const fs = fakeFs({
      dirs: { [PROJECTS]: ["-w-kore"], [`${PROJECTS}/-w-kore`]: [] },
    });
    const { runner } = gitRunner({ "rev-parse": "/w/kore/.git\n" });
    expect(await dirs(fs, runner)).toEqual([`${PROJECTS}/-w-kore`]);
  });

  it("falls back to the repository root when git reports nothing", async () => {
    const fs = fakeFs({
      dirs: { [PROJECTS]: ["-w-kore-sub"], [`${PROJECTS}/-w-kore-sub`]: [] },
    });
    const { runner } = gitRunner({ worktree: "x", "rev-parse": "x" }, 1);
    expect(await dirs(fs, runner)).toEqual([`${PROJECTS}/-w-kore-sub`]);
  });
});

describe("readTranscripts", () => {
  it("keeps the fuller copy of a session resumed in two directories, sorted by id, and only .jsonl files", async () => {
    const fs = fakeFs({
      dirs: {
        "/a": ["s2.jsonl", "s1.jsonl"],
        "/b": ["s1.jsonl", "notes.txt"],
      },
      files: {
        "/a/s2.jsonl": '{"n":1}\n',
        "/a/s1.jsonl": "short\n",
        "/b/s1.jsonl": "a much longer copy\n",
      },
    });
    expect(await readTranscripts(port(fs), ["/a", "/b"])).toEqual([
      { id: "s1", text: "a much longer copy\n" },
      { id: "s2", text: '{"n":1}\n' },
    ]);
    expect(fs.readFile).not.toHaveBeenCalledWith("/b/notes.txt");
  });
});
