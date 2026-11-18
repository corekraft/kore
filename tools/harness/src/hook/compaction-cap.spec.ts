// The compaction cap the stop hook reads from the harness config under the repository root
// (#1032). A missing, unreadable or refused config yields no cap, so a stop never blocks on
// it; the reports refuse a bad config with its message. The file system, the path helper and
// the config parser are mocks, since they belong to other units (ADR 0098).

import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseHarnessConfig } from "../flow/index.js";
import type { FileSystem } from "../runtime/index.js";
import { compactionCapOf } from "./compaction-cap.js";

vi.mock("node:path", () => ({ join: vi.fn() }));
vi.mock("../flow/index.js", () => ({
  HARNESS_CONFIG: ".claude/harness.json",
  parseHarnessConfig: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
  vi.mocked(parseHarnessConfig).mockReset();
});

/** A parser result, as the config parser returns it; the test sets what it holds. */
const parsed = (value: object) =>
  value as ReturnType<typeof parseHarnessConfig>;

/** A file system whose config read is a mock with the given behaviour, returned beside the file system. */
function fakeFs(behaviour: FileSystem["readFile"]) {
  const readFile = vi.fn<FileSystem["readFile"]>(behaviour);
  const used: Pick<FileSystem, "readFile"> = { readFile };
  return { fs: used as FileSystem, readFile };
}

describe("compaction cap read by the stop hook", () => {
  it("returns the cap the config sets, reading the config under the repository root", async () => {
    const { fs, readFile } = fakeFs(() =>
      Promise.resolve('{"compactionCap":80000}'),
    );
    vi.mocked(parseHarnessConfig).mockReturnValue(
      parsed({ compactionCap: 80000 }),
    );
    expect(await compactionCapOf(fs, "/repo")).toBe(80000);
    expect(readFile.mock.calls).toEqual([["/repo/.claude/harness.json"]]);
    expect(vi.mocked(parseHarnessConfig).mock.calls).toEqual([
      ['{"compactionCap":80000}', ".claude/harness.json"],
    ]);
  });

  it("returns no cap when the config leaves it out, so no request is measured against one", async () => {
    const { fs } = fakeFs(() => Promise.resolve('{"ownerLogin":"junners"}'));
    vi.mocked(parseHarnessConfig).mockReturnValue(
      parsed({ ownerLogin: "junners" }),
    );
    expect(await compactionCapOf(fs, "/repo")).toBeUndefined();
  });

  it("returns no cap, and does not parse, when there is no config file", async () => {
    const { fs } = fakeFs(() =>
      Promise.reject(Object.assign(new Error("gone"), { code: "ENOENT" })),
    );
    expect(await compactionCapOf(fs, "/repo")).toBeUndefined();
    expect(vi.mocked(parseHarnessConfig)).not.toHaveBeenCalled();
  });

  it("returns no cap for a refused config, rather than failing the stop", async () => {
    const { fs } = fakeFs(() => Promise.resolve('{"compactionCap":0}'));
    vi.mocked(parseHarnessConfig).mockReturnValue(
      parsed({
        error:
          'Invalid .claude/harness.json: key "compactionCap" must be a whole number of at least 1. Fix the value.',
      }),
    );
    expect(await compactionCapOf(fs, "/repo")).toBeUndefined();
  });

  it("returns no cap for a config that cannot be read, rather than failing the stop", async () => {
    const { fs } = fakeFs(() =>
      Promise.reject(Object.assign(new Error("I/O"), { code: "EIO" })),
    );
    expect(await compactionCapOf(fs, "/repo")).toBeUndefined();
  });
});
