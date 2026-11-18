// Finding the transcript the prompt-size command reads (#1038): the newest session of this
// checkout by default, or one named by its Claude session id that the repository's own
// transcript directories hold. The file system, the repository's transcript directories and
// the home directory are mocks (ADR 0098).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDirs } from "./retro-transcripts.js";
import { fakeDeps, type FakeDeps } from "./prompt-size-support.js";
import { locateDefault, locateNamed } from "./prompt-size-read.js";

vi.mock("./retro-transcripts.js", () => ({ defaultDirs: vi.fn() }));
vi.mock("node:os", () => ({ homedir: vi.fn(() => "/home/u") }));

const ROOT = "/repo";
const PROJECT = "-repo";
const SESSION_A = "11111111-aaaa-4bbb-8ccc-000000000001";
const SESSION_B = "22222222-aaaa-4bbb-8ccc-000000000002";

const NO_DEFAULT = (dir: string) =>
  `No session transcript for this checkout yet: none in ${dir}. Run this from a Claude session of this checkout, or name a session by its Claude session id: harness session prompt-size <session-id>.`;
const NAMED_MISSING = (id: string) =>
  `Session ${id} is not a session of this repository: no ${id}.jsonl in its Claude session directories (the main checkout and its worktrees). Name a session by its Claude session id, or run the command with no name for this checkout's newest session.`;

beforeEach(() => {
  vi.mocked(defaultDirs).mockReset();
});

describe("locateDefault", () => {
  it("reads the newest transcript of this checkout's project directory and names its session", async () => {
    const deps: FakeDeps = fakeDeps();
    const dir = `/home/u/.claude/projects/${PROJECT}`;
    deps.fs.readdir.mockResolvedValue([
      `${SESSION_A}.jsonl`,
      "notes.txt",
      `${SESSION_B}.jsonl`,
    ]);
    deps.fs.mtimeMs.mockImplementation((path: string) =>
      Promise.resolve(path.includes(SESSION_A) ? 100 : 200),
    );
    deps.fs.readFile.mockResolvedValue("the newest transcript");

    const found = await locateDefault(deps, ROOT);

    expect(deps.fs.readdir).toHaveBeenCalledExactlyOnceWith(dir);
    expect(deps.fs.readFile).toHaveBeenCalledExactlyOnceWith(
      `${dir}/${SESSION_B}.jsonl`,
    );
    expect(found).toEqual({
      session: SESSION_B,
      text: "the newest transcript",
    });
  });

  it("reads the project directory under CLAUDE_CONFIG_DIR when it is set", async () => {
    const deps: FakeDeps = fakeDeps();
    deps.env = { CLAUDE_CONFIG_DIR: "/cfg" };
    deps.fs.readdir.mockResolvedValue([`${SESSION_A}.jsonl`]);
    deps.fs.mtimeMs.mockResolvedValue(1);
    deps.fs.readFile.mockResolvedValue("text");

    await locateDefault(deps, ROOT);

    expect(deps.fs.readdir).toHaveBeenCalledExactlyOnceWith(
      `/cfg/projects/${PROJECT}`,
    );
  });

  it("refuses with what it looked for and how to name a session, when the project has no transcript", async () => {
    const deps: FakeDeps = fakeDeps();
    const dir = `/home/u/.claude/projects/${PROJECT}`;
    deps.fs.readdir.mockRejectedValue(
      Object.assign(new Error("no dir"), { code: "ENOENT" }),
    );

    expect(await locateDefault(deps, ROOT)).toEqual({ error: NO_DEFAULT(dir) });
    expect(deps.fs.readFile).not.toHaveBeenCalled();
  });

  it("refuses when the project directory holds no transcript", async () => {
    const deps: FakeDeps = fakeDeps();
    const dir = `/home/u/.claude/projects/${PROJECT}`;
    deps.fs.readdir.mockResolvedValue(["notes.txt"]);

    expect(await locateDefault(deps, ROOT)).toEqual({ error: NO_DEFAULT(dir) });
  });
});

describe("locateNamed", () => {
  it("reads the transcript named by its session id from the first repository directory that holds it", async () => {
    const deps: FakeDeps = fakeDeps();
    vi.mocked(defaultDirs).mockResolvedValue(["/d/main", "/d/worktree"]);
    deps.fs.exists.mockImplementation((path: string) =>
      Promise.resolve(path === `/d/worktree/${SESSION_B}.jsonl`),
    );
    deps.fs.readFile.mockResolvedValue("the named transcript");

    const found = await locateNamed(deps, ROOT, SESSION_B);

    expect(defaultDirs).toHaveBeenCalledExactlyOnceWith(
      deps.fs,
      deps.runner,
      ROOT,
      "/home/u",
    );
    expect(deps.fs.readFile).toHaveBeenCalledExactlyOnceWith(
      `/d/worktree/${SESSION_B}.jsonl`,
    );
    expect(found).toEqual({ session: SESSION_B, text: "the named transcript" });
  });

  it("refuses a session that no repository directory holds, naming the file it looked for", async () => {
    const deps: FakeDeps = fakeDeps();
    vi.mocked(defaultDirs).mockResolvedValue(["/d/main"]);
    deps.fs.exists.mockResolvedValue(false);

    expect(await locateNamed(deps, ROOT, SESSION_A)).toEqual({
      error: NAMED_MISSING(SESSION_A),
    });
    expect(deps.fs.readFile).not.toHaveBeenCalled();
  });

  it("refuses when the repository has no transcript directory at all", async () => {
    const deps: FakeDeps = fakeDeps();
    vi.mocked(defaultDirs).mockResolvedValue([]);

    expect(await locateNamed(deps, ROOT, SESSION_A)).toEqual({
      error: NAMED_MISSING(SESSION_A),
    });
    expect(deps.fs.exists).not.toHaveBeenCalled();
  });
});
