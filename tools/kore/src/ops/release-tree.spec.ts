import assert from "node:assert/strict";
import { test } from "vitest";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";
import { checkoutRelease, releaseKore, removeRelease } from "./release-tree.js";

class Recorder implements Runner {
  calls: {
    command: string;
    args: readonly string[];
    options?: RunOptions | undefined;
  }[] = [];
  constructor(
    private readonly failOn?: string,
    private readonly message = `${failOn} failed`,
  ) {}
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, options });
    if (this.failOn && args.includes(this.failOn)) {
      throw new Error(this.message);
    }
    return { stdout: "", stderr: "", code: 0 };
  }
}

test("a release tag is checked out detached outside the working tree, then built from its lockfile", async () => {
  const runner = new Recorder();
  await checkoutRelease(runner, "/repo", "v0.4.0", "/tmp/kore-v0.4.0");
  const [first, ...rest] = runner.calls;
  assert.deepEqual(first?.args, [
    "worktree",
    "add",
    "--detach",
    "/tmp/kore-v0.4.0",
    "v0.4.0",
  ]);
  assert.equal(first?.options?.cwd, "/repo");
  assert.deepEqual(
    rest.map((call) => call.args.join(" ")),
    ["--prefix tools/kore ci", "--prefix tools/kore run build"],
  );
  assert.ok(rest.every((call) => call.options?.cwd === "/tmp/kore-v0.4.0"));
});

test("a ref that is not a release tag is refused before anything runs", async () => {
  const runner = new Recorder();
  await assert.rejects(
    checkoutRelease(runner, "/repo", "main", "/tmp/x"),
    /release tag like v0\.4\.0/,
  );
  assert.equal(runner.calls.length, 0);
});

test("a failed build removes the worktree it created and reports the cause", async () => {
  const runner = new Recorder("build");
  await assert.rejects(
    checkoutRelease(runner, "/repo", "v0.4.0", "/tmp/x"),
    /build failed/,
  );
  assert.deepEqual(runner.calls.at(-1)?.args, [
    "worktree",
    "remove",
    "--force",
    "/tmp/x",
  ]);
});

test("the previous release's own CLI runs against its own tree, never the working tree", async () => {
  const runner = new Recorder();
  await releaseKore(runner, "/tmp/x", [
    "local",
    "up",
    "--environment",
    "local",
  ]);
  const call = runner.calls[0]!;
  assert.equal(call.command, "node");
  assert.deepEqual(call.args, [
    "dist/src/cli/cli.js",
    "local",
    "up",
    "--environment",
    "local",
  ]);
  assert.equal(call.options?.cwd, "/tmp/x/tools/kore");
  assert.equal(call.options?.env?.["KORE_ROOT"], "/tmp/x");
});

test("removing a release tree is safe to repeat but reports other failures", async () => {
  const gone = new Recorder("remove", "fatal: '/tmp/x' is not a working tree");
  await removeRelease(gone, "/repo", "/tmp/x");
  assert.equal(gone.calls[0]?.options?.cwd, "/repo");
  await assert.rejects(
    removeRelease(new Recorder("remove", "disk full"), "/repo", "/tmp/x"),
    /disk full/,
  );
});
