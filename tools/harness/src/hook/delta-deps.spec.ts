// Delta's real dependencies: what they read, and what they tolerate.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPlans } from "../plan/index.js";
import {
  hostLocksDirectory,
  type CliDeps,
  type FileSystem,
  type Runner,
} from "../runtime/index.js";
import { realDeltaDeps } from "./delta-deps.js";

// Collaborators with behaviour are automocked; the path helpers get fakes that
// join and resolve by plain concatenation, which is all these paths need.
vi.mock("../plan/index.js", () => ({ readPlans: vi.fn() }));
vi.mock("../runtime/index.js", () => ({ hostLocksDirectory: vi.fn() }));
vi.mock("node:path", () => ({ join: vi.fn(), resolve: vi.fn() }));

const LOCKS = "/home/jun/.kore/locks";
const JOURNAL = "/repo/.kore/state/journal";
const SNAPSHOTS = "/repo/.git/kore-delta";
const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });

/** A typed CliDeps whose file system and runner are mocks; git answers with the repository's git dir. */
function fakeCli() {
  const fs = {
    readFile: vi.fn<FileSystem["readFile"]>(),
    writeFile: vi.fn<FileSystem["writeFile"]>(),
    readdir: vi.fn<FileSystem["readdir"]>(),
    remove: vi.fn<FileSystem["remove"]>(),
    mtimeMs: vi.fn<FileSystem["mtimeMs"]>(),
  };
  const runner = { run: vi.fn<Runner["run"]>() };
  const clock = { now: vi.fn(() => new Date(1_000)) };
  runner.run.mockResolvedValue({ code: 0, stdout: ".git\n", stderr: "" });
  const deps = { fs, runner, clock } as unknown as CliDeps;
  return { deps, fs, runner, clock };
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(resolve).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(hostLocksDirectory).mockReturnValue(LOCKS);
  vi.mocked(readPlans).mockResolvedValue({});
});

describe("delta locks", () => {
  it("lists the host's locks, which every worktree on the host shares", async () => {
    const cli = fakeCli();
    cli.fs.readdir.mockResolvedValue(["kore-local.lock"]);
    const deps = realDeltaDeps(cli.deps, "/repo");
    expect(await deps.listLocks()).toEqual(["kore-local.lock"]);
    expect(cli.fs.readdir.mock.calls).toEqual([[LOCKS]]);
  });

  it("reads no locks when the host's lock directory is missing", async () => {
    const cli = fakeCli();
    cli.fs.readdir.mockRejectedValue(enoent());
    expect(await realDeltaDeps(cli.deps, "/repo").listLocks()).toEqual([]);
  });

  it("rethrows a directory error that is not a missing directory", async () => {
    const cli = fakeCli();
    cli.fs.readdir.mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(realDeltaDeps(cli.deps, "/repo").listLocks()).rejects.toThrow(
      "denied",
    );
  });
});

describe("delta journals", () => {
  it("skips torn lines, non-object lines and files that are not journals", async () => {
    const cli = fakeCli();
    cli.fs.readdir.mockResolvedValue(["local.jsonl", "notes.txt"]);
    cli.fs.readFile.mockResolvedValue(
      `{"op":"a","kind":"start"}\nnot json\n42\nnull\n`,
    );
    const journals = await realDeltaDeps(cli.deps, "/repo").readJournals();
    expect(journals).toEqual({ local: [{ op: "a", kind: "start" }] });
    expect(cli.fs.readFile.mock.calls).toEqual([[`${JOURNAL}/local.jsonl`]]);
  });

  it("reads no journals when the directory is missing", async () => {
    const cli = fakeCli();
    cli.fs.readdir.mockRejectedValue(enoent());
    expect(await realDeltaDeps(cli.deps, "/repo").readJournals()).toEqual({});
  });

  it("keeps the other journals when one cannot be read", async () => {
    const cli = fakeCli();
    cli.fs.readdir.mockResolvedValue(["a.jsonl", "b.jsonl"]);
    cli.fs.readFile.mockImplementation((path) =>
      path.endsWith("a.jsonl")
        ? Promise.reject(new Error("EIO"))
        : Promise.resolve(`{"op":"b"}`),
    );
    const journals = await realDeltaDeps(cli.deps, "/repo").readJournals();
    expect(Object.keys(journals)).toEqual(["b"]);
  });
});

describe("delta git state", () => {
  it("reads the clock in epoch milliseconds", () => {
    const cli = fakeCli();
    expect(realDeltaDeps(cli.deps, "/repo").now()).toBe(1_000);
  });

  it("has no main when the branch does not exist", async () => {
    const cli = fakeCli();
    cli.runner.run.mockResolvedValue({ code: 1, stdout: "", stderr: "" });
    expect(await realDeltaDeps(cli.deps, "/repo").main()).toBeNull();
  });

  it("lists commit subjects between two commits, newest first", async () => {
    const cli = fakeCli();
    cli.runner.run.mockResolvedValueOnce({
      code: 0,
      stdout: "fix: b\nfeat: a\n",
      stderr: "",
    });
    const subjects = await realDeltaDeps(cli.deps, "/repo").commitsBetween(
      "1",
      "2",
    );
    expect(subjects).toEqual(["fix: b", "feat: a"]);
    expect(cli.runner.run.mock.calls.at(-1)).toEqual([
      "git",
      ["log", "--format=%s", "1..2"],
      { cwd: "/repo" },
    ]);
  });
});

describe("delta snapshot inputs", () => {
  it("reads the head, the branch and the plans for the snapshot", async () => {
    const cli = fakeCli();
    cli.runner.run.mockResolvedValueOnce({
      code: 0,
      stdout: "abc\n",
      stderr: "",
    });
    cli.runner.run.mockResolvedValueOnce({
      code: 0,
      stdout: "feat/x\n",
      stderr: "",
    });
    vi.mocked(readPlans).mockResolvedValueOnce({ "6-plan.md": "- [ ] Build" });
    const deps = realDeltaDeps(cli.deps, "/repo");
    expect(await deps.head()).toBe("abc");
    expect(await deps.branch()).toBe("feat/x");
    expect(await deps.readPlans()).toEqual({ "6-plan.md": "- [ ] Build" });
  });
});

describe("delta snapshot store", () => {
  it("writes a snapshot under the git directory, not the working tree", async () => {
    const cli = fakeCli();
    const snap = {
      head: "a",
      branch: "b",
      main: null,
      plans: {},
      locks: [],
      journal: {},
    };
    await realDeltaDeps(cli.deps, "/repo").writeSnapshot("s1", snap);
    expect(cli.fs.writeFile.mock.calls).toEqual([
      [`${SNAPSHOTS}/s1.json`, JSON.stringify(snap)],
    ]);
  });

  it("reads back a snapshot and treats a damaged one as missing", async () => {
    const cli = fakeCli();
    const snap = {
      head: "a",
      branch: "b",
      main: null,
      plans: {},
      locks: [],
      journal: {},
    };
    const deps = realDeltaDeps(cli.deps, "/repo");
    cli.fs.readFile.mockResolvedValueOnce(JSON.stringify(snap));
    expect(await deps.readSnapshot("s1")).toEqual(snap);
    cli.fs.readFile.mockResolvedValueOnce("{");
    expect(await deps.readSnapshot("s1")).toBeNull();
  });

  it("lists snapshot files with their age, and removes one by its path", async () => {
    const cli = fakeCli();
    cli.fs.readdir.mockResolvedValue(["s1.json", "notes.txt"]);
    cli.fs.mtimeMs.mockResolvedValue(42);
    const deps = realDeltaDeps(cli.deps, "/repo");
    expect(await deps.listSnapshots()).toEqual([{ id: "s1", mtimeMs: 42 }]);
    await deps.removeSnapshot("s1");
    expect(cli.fs.remove.mock.calls).toEqual([[`${SNAPSHOTS}/s1.json`]]);
  });
});
