import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readPlans } from "./store.js";
import { fakeDeps, ROOT } from "./plan-support.js";

// node:path is an automock; join is given its real joining behaviour.
vi.mock("node:path");

const enoent = Object.assign(new Error("gone"), { code: "ENOENT" });

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts) => parts.join("/"));
});

describe("readPlans", () => {
  it("reads every .md file under the plans directory of the root, by file name", async () => {
    const deps = fakeDeps();
    vi.mocked(deps.fs.readdir).mockResolvedValue([
      "1-a.md",
      "notes.txt",
      "2-b.md",
    ]);
    vi.mocked(deps.fs.readFile).mockImplementation((path) =>
      Promise.resolve(`text of ${path}`),
    );
    expect(await readPlans(deps)).toEqual({
      "1-a.md": `text of ${ROOT}/infra/plans/1-a.md`,
      "2-b.md": `text of ${ROOT}/infra/plans/2-b.md`,
    });
    expect(deps.fs.readdir).toHaveBeenCalledWith(`${ROOT}/infra/plans`);
    expect(vi.mocked(deps.fs.readFile).mock.calls).toEqual([
      [`${ROOT}/infra/plans/1-a.md`],
      [`${ROOT}/infra/plans/2-b.md`],
    ]);
  });

  it("returns no plans, and reads none, when the plans directory is absent", async () => {
    const deps = fakeDeps();
    vi.mocked(deps.fs.readdir).mockRejectedValue(enoent);
    expect(await readPlans(deps)).toEqual({});
    expect(deps.fs.readFile).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected read error instead of reporting no plans", async () => {
    const deps = fakeDeps();
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.mocked(deps.fs.readdir).mockRejectedValue(denied);
    await expect(readPlans(deps)).rejects.toBe(denied);
  });

  it("resolves the root before it reads the directory", async () => {
    const deps = fakeDeps();
    vi.mocked(deps.fs.readdir).mockResolvedValue([]);
    await readPlans(deps);
    expect(deps.root).toHaveBeenCalledTimes(1);
    expect(join).toHaveBeenCalledWith(ROOT, "infra/plans");
  });
});
