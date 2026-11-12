import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeFileSystem } from "./filesystem.js";
import { systemClock } from "./clock.js";
import { ProcessRunner } from "./runner.js";
import { FakeRunner } from "./runner-support.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true })));
});
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "harness-runtime-"));
  dirs.push(dir);
  return dir;
}

describe("ProcessRunner", () => {
  it("captures stdout, stderr and the exit code", async () => {
    const result = await new ProcessRunner().run(process.execPath, [
      "-e",
      "console.log('out'); console.error('err'); process.exit(3)",
    ]);
    expect(result).toEqual({ stdout: "out\n", stderr: "err\n", code: 3 });
  });

  it("passes stdin input and cwd", async () => {
    const cwd = await tempDir();
    const result = await new ProcessRunner().run(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      { input: "hello", cwd },
    );
    expect(result.stdout).toBe("hello");
  });

  it("resolves with a non-zero code when the command does not exist", async () => {
    const result = await new ProcessRunner().run("harness-no-such-command", []);
    expect(result.code).not.toBe(0);
  });
});

describe("FakeRunner", () => {
  it("records calls and answers from scripted responses, defaulting to success", async () => {
    const runner = new FakeRunner([
      {
        match: (c, a) => c === "git" && a[0] === "status",
        result: { stdout: "clean", code: 0 },
      },
    ]);
    expect((await runner.run("git", ["status"])).stdout).toBe("clean");
    expect(await runner.run("ls", [])).toEqual({
      stdout: "",
      stderr: "",
      code: 0,
    });
    expect(runner.calls.map((c) => c.command)).toEqual(["git", "ls"]);
  });
});

describe("nodeFileSystem", () => {
  it("round-trips files, creates parents, lists and checks existence", async () => {
    const dir = await tempDir();
    const file = join(dir, "a", "b.txt");
    expect(await nodeFileSystem.exists(file)).toBe(false);
    await nodeFileSystem.writeFile(file, "x");
    expect(await nodeFileSystem.readFile(file)).toBe("x");
    expect(await nodeFileSystem.exists(file)).toBe(true);
    expect(await nodeFileSystem.readdir(join(dir, "a"))).toEqual(["b.txt"]);
  });

  it("rethrows errors other than a missing file from exists", async () => {
    const dir = await tempDir();
    await nodeFileSystem.writeFile(join(dir, "f"), "x");
    await expect(
      nodeFileSystem.exists(join(dir, "f", "child")),
    ).rejects.toThrow();
  });
});

describe("systemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(before);
  });
});
