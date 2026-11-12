// Delta's real dependencies: what they read, and what they tolerate.
// Plan: infra/plans/6-agent-primitives.md#step-3-what-changed-between-turns

import { describe, expect, it } from "vitest";
import { testHarness } from "../cli/cli-support.js";
import type { FakeResponse } from "../runtime/runner-support.js";
import { realDeltaDeps } from "./delta-deps.js";

const gitDir: FakeResponse = {
  match: (_c, args) => args.includes("--git-dir"),
  result: { stdout: ".git\n" },
};

function depsFor(
  files: Record<string, string>,
  responses: FakeResponse[] = [],
) {
  const h = testHarness({ files, responses: [gitDir, ...responses] });
  return { h, deps: realDeltaDeps(h.deps, "/repo") };
}

describe("delta journals", () => {
  const journal = "/repo/.kore/state/journal";

  it("skips torn lines, non-object lines and files that are not journals", async () => {
    const { deps } = depsFor({
      [`${journal}/local.jsonl`]: `{"op":"a","kind":"start"}\nnot json\n42\nnull\n`,
      [`${journal}/notes.txt`]: "ignored",
    });
    expect(await deps.readJournals()).toEqual({
      local: [{ op: "a", kind: "start" }],
    });
  });

  it("reads no journals when the directory is missing", async () => {
    const { deps } = depsFor({});
    expect(await deps.readJournals()).toEqual({});
    expect(await deps.listLocks()).toEqual([]);
    expect(await deps.readPlans()).toEqual({});
  });

  it("keeps the other journals when one cannot be read", async () => {
    const { h, deps } = depsFor({
      [`${journal}/a.jsonl`]: `{"op":"a"}`,
      [`${journal}/b.jsonl`]: `{"op":"b"}`,
    });
    const read = h.deps.fs.readFile.bind(h.deps.fs);
    h.deps.fs.readFile = (path) =>
      path.endsWith("a.jsonl") ? Promise.reject(new Error("EIO")) : read(path);
    expect(Object.keys(await deps.readJournals())).toEqual(["b"]);
  });

  it("rethrows a directory error that is not a missing directory", async () => {
    const { h, deps } = depsFor({});
    h.deps.fs.readdir = () =>
      Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }));
    await expect(deps.listLocks()).rejects.toThrow("denied");
  });
});

describe("delta git state", () => {
  it("has no main when the branch does not exist", async () => {
    const { deps } = depsFor({}, [
      {
        match: (_c, args) => args.includes("--verify"),
        result: { code: 1 },
      },
    ]);
    expect(await deps.main()).toBeNull();
  });

  it("lists commit subjects between two commits, newest first", async () => {
    const { deps } = depsFor({}, [
      {
        match: (_c, args) => args[0] === "log",
        result: { stdout: "fix: b\nfeat: a\n" },
      },
    ]);
    expect(await deps.commitsBetween("1", "2")).toEqual(["fix: b", "feat: a"]);
  });

  it("round-trips a snapshot and treats a damaged one as missing", async () => {
    const { h, deps } = depsFor({});
    const snap = {
      head: "a",
      branch: "b",
      main: null,
      plans: {},
      locks: [],
      journal: {},
    };
    await deps.writeSnapshot("s1", snap);
    expect(await deps.readSnapshot("s1")).toEqual(snap);
    h.files.set("/repo/.git/kore-delta/s1.json", "{");
    expect(await deps.readSnapshot("s1")).toBeNull();
    expect(await deps.listSnapshots()).toEqual([{ id: "s1", mtimeMs: 0 }]);
    await deps.removeSnapshot("s1");
    expect(await deps.readSnapshot("s1")).toBeNull();
  });
});
