import { expect, test, vi } from "vitest";
import { CommandError, type Runner } from "../runtime/index.js";
import { gitAppSource } from "./app-source.js";

const dir = "/work/leads";

// A fake runner: each call returns the next scripted outcome, or throws it.
function scriptedRunner(...outcomes: (string | Error)[]) {
  const run = vi.fn<Runner["run"]>();
  for (const outcome of outcomes) {
    if (outcome instanceof Error) {
      run.mockRejectedValueOnce(outcome);
    } else {
      run.mockResolvedValueOnce({ stdout: outcome, stderr: "", code: 0 });
    }
  }
  return { run } satisfies Runner;
}

const failedGit = (args: string[]) =>
  new CommandError("git", args, {
    stdout: "",
    stderr: "fatal: bad revision",
    code: 128,
  });

test("the changed paths are the files git lists between the base and HEAD", async () => {
  const runner = scriptedRunner("src/app.ts\nflags.yaml\n\n");
  const source = gitAppSource({
    runner,
    dir,
    base: "main",
    readText: async () => undefined,
  });
  expect(await source.changedPaths()).toEqual(["src/app.ts", "flags.yaml"]);
  expect(runner.run).toHaveBeenCalledWith("git", [
    "-C",
    dir,
    "diff",
    "--name-only",
    "main",
    "HEAD",
  ]);
});

test("the head message is the full message of the head commit, read with git log", async () => {
  const runner = scriptedRunner(
    "feat: add it\n\nSafety-pattern: feature-flagged\n",
  );
  const source = gitAppSource({
    runner,
    dir,
    base: "main",
    readText: async () => undefined,
  });
  expect(await source.headMessage()).toBe(
    "feat: add it\n\nSafety-pattern: feature-flagged\n",
  );
  expect(runner.run).toHaveBeenCalledWith("git", [
    "-C",
    dir,
    "log",
    "-1",
    "--format=%B",
    "HEAD",
  ]);
});

test("the base flags file is read from the base commit, and a base without one reads as none", async () => {
  const runner = scriptedRunner(
    failedGit(["-C", dir, "show", "main:flags.yaml"]),
  );
  const source = gitAppSource({
    runner,
    dir,
    base: "main",
    readText: async () => undefined,
  });
  expect(await source.baseFlagsText()).toBeUndefined();
  expect(runner.run).toHaveBeenCalledWith("git", [
    "-C",
    dir,
    "show",
    "main:flags.yaml",
  ]);
});

test("a base flags file that exists is returned as text", async () => {
  const runner = scriptedRunner('{"service":"leads","flags":[]}');
  const source = gitAppSource({
    runner,
    dir,
    base: "main",
    readText: async () => undefined,
  });
  expect(await source.baseFlagsText()).toBe('{"service":"leads","flags":[]}');
});

test("a git failure other than a missing file is not swallowed", async () => {
  const runner = scriptedRunner(new Error("spawn git ENOENT"));
  const source = gitAppSource({
    runner,
    dir,
    base: "main",
    readText: async () => undefined,
  });
  await expect(source.baseFlagsText()).rejects.toThrow("spawn git ENOENT");
});

test("the working tree's flags.yaml is read from the app directory", async () => {
  const readText = vi.fn(async () => "{}");
  const source = gitAppSource({
    runner: scriptedRunner(),
    dir,
    base: "main",
    readText,
  });
  expect(await source.flagsText()).toBe("{}");
  expect(readText).toHaveBeenCalledWith(`${dir}/flags.yaml`);
});
