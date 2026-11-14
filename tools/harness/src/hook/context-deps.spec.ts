// The files the context hook reads, through typed mocks of the file system,
// the plan barrel and the clock of the retrospective window.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPlans } from "../plan/index.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import { realContextDeps, readJournals } from "./context-deps.js";
import { windowStart } from "./retro-scan.js";

vi.mock("node:os");
vi.mock("node:path");
vi.mock("../plan/index.js", () => ({ readPlans: vi.fn() }));
vi.mock("./retro-scan.js", () => ({ windowStart: vi.fn() }));

const enoent = () => Object.assign(new Error("missing"), { code: "ENOENT" });
const JOURNALS = "/repo/.kore/state/journal";

/** A typed file system whose every method is a mock; nothing is read from disk. */
function fakeFs() {
  return {
    readFile: vi.fn<FileSystem["readFile"]>(),
    readdir: vi.fn<FileSystem["readdir"]>(),
    mtimeMs: vi.fn<FileSystem["mtimeMs"]>(),
  };
}

/** CliDeps around the fake file system, with the environment the spec gives. */
function fakeCli(env: Record<string, string | undefined> = {}) {
  const fs = fakeFs();
  return { fs, deps: { fs, env } as unknown as CliDeps };
}

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(homedir).mockReturnValue("/home/jun");
  vi.mocked(readPlans).mockResolvedValue({ "3-plan.md": "text" });
  vi.mocked(windowStart).mockReturnValue(1_000);
});

describe("context journals", () => {
  it("parses each journal into its environment, skipping files that are not journals", async () => {
    const { fs } = fakeCli();
    fs.readdir.mockResolvedValue(["local.jsonl", "notes.txt"]);
    fs.readFile.mockResolvedValue('{"kind":"start","op":"a"}\n');
    expect(await readJournals(fs as unknown as FileSystem, "/repo")).toEqual({
      local: [{ kind: "start", op: "a" }],
    });
    expect(fs.readFile.mock.calls).toEqual([[`${JOURNALS}/local.jsonl`]]);
  });

  it("skips torn lines and entries that are not objects", async () => {
    const { fs } = fakeCli();
    fs.readdir.mockResolvedValue(["local.jsonl"]);
    fs.readFile.mockResolvedValue('not json\n42\nnull\n{"kind":"end"}\n');
    expect(await readJournals(fs as unknown as FileSystem, "/repo")).toEqual({
      local: [{ kind: "end" }],
    });
  });

  it("reads no journals when the directory is missing", async () => {
    const { fs } = fakeCli();
    fs.readdir.mockRejectedValue(enoent());
    expect(await readJournals(fs as unknown as FileSystem, "/repo")).toEqual(
      {},
    );
  });

  it("keeps the other journals when one cannot be read", async () => {
    const { fs } = fakeCli();
    fs.readdir.mockResolvedValue(["a.jsonl", "b.jsonl"]);
    fs.readFile.mockImplementation((path) =>
      path.endsWith("a.jsonl")
        ? Promise.reject(new Error("EIO"))
        : Promise.resolve('{"kind":"start"}'),
    );
    expect(
      Object.keys(await readJournals(fs as unknown as FileSystem, "/repo")),
    ).toEqual(["b"]);
  });

  it("rethrows a directory error that is not a missing directory", async () => {
    const { fs } = fakeCli();
    fs.readdir.mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(
      readJournals(fs as unknown as FileSystem, "/repo"),
    ).rejects.toThrow("denied");
  });
});

describe("context dependencies, AGENTS.md and plans", () => {
  it("reads AGENTS.md at the repository root", async () => {
    const { fs, deps } = fakeCli();
    fs.readFile.mockResolvedValue("# AGENTS.md");
    expect(await realContextDeps(deps, "/repo").readAgents()).toBe(
      "# AGENTS.md",
    );
    expect(fs.readFile.mock.calls).toEqual([["/repo/AGENTS.md"]]);
  });

  it("reads the plans through the shared plan parser, with the same dependencies", async () => {
    const { deps } = fakeCli();
    expect(await realContextDeps(deps, "/repo").readPlans()).toEqual({
      "3-plan.md": "text",
    });
    expect(vi.mocked(readPlans).mock.calls).toEqual([[deps]]);
  });
});

describe("context dependencies, journals and transcripts", () => {
  it("reads the journals under the same root", async () => {
    const { fs, deps } = fakeCli();
    fs.readdir.mockResolvedValue(["local.jsonl"]);
    fs.readFile.mockResolvedValue('{"kind":"start"}');
    expect(await realContextDeps(deps, "/repo").readJournals()).toEqual({
      local: [{ kind: "start" }],
    });
  });
});

describe("context dependencies, sessions since the marker", () => {
  const transcripts = "/home/jun/.claude/projects/-repo";

  it("counts transcripts modified at or after the window, not the current session's", async () => {
    const { fs, deps } = fakeCli();
    fs.readdir.mockResolvedValue(["a.jsonl", "s1.jsonl", "b.txt", "c.jsonl"]);
    fs.mtimeMs.mockImplementation((path) =>
      Promise.resolve(path.endsWith("a.jsonl") ? 2_000 : 500),
    );
    const sessions = await realContextDeps(deps, "/repo").sessionsSince(
      "2026-11-01",
      "s1",
    );
    expect(sessions).toBe(1);
    expect(vi.mocked(windowStart).mock.calls).toEqual([["2026-11-01"]]);
    expect(fs.readdir.mock.calls).toEqual([[transcripts]]);
  });

  it("looks in the configured config directory, and counts from the start with no marker", async () => {
    const { fs, deps } = fakeCli({ CLAUDE_CONFIG_DIR: "/cfg" });
    fs.readdir.mockResolvedValue(["a.jsonl"]);
    fs.mtimeMs.mockResolvedValue(9_999);
    vi.mocked(windowStart).mockReturnValue(0);
    expect(
      await realContextDeps(deps, "/repo").sessionsSince(null, undefined),
    ).toBe(1);
    expect(vi.mocked(windowStart).mock.calls).toEqual([[undefined]]);
    expect(fs.readdir.mock.calls).toEqual([["/cfg/projects/-repo"]]);
  });

  it("counts no sessions when the project has no transcript directory", async () => {
    const { fs, deps } = fakeCli();
    fs.readdir.mockRejectedValue(enoent());
    expect(await realContextDeps(deps, "/repo").sessionsSince(null, "s1")).toBe(
      0,
    );
  });

  it("rethrows a transcript directory error that is not a missing directory", async () => {
    const { fs, deps } = fakeCli();
    fs.readdir.mockRejectedValue(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    await expect(
      realContextDeps(deps, "/repo").sessionsSince(null, "s1"),
    ).rejects.toThrow("denied");
  });
});
