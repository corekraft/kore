import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessRunner } from "./runner.js";

vi.mock("node:child_process");

/** A child process with the streams and signals the runner listens to. */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = { end: vi.fn() };
  readonly kill = vi.fn();

  /** The child as the spawn call returns it. */
  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

let child: FakeChild;

beforeEach(() => {
  child = new FakeChild();
  vi.mocked(spawn).mockReturnValue(child.asChildProcess());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProcessRunner: starting the child", () => {
  it("spawns the command with its arguments and the parent environment when none is given", () => {
    const runner = new ProcessRunner();

    void runner.run("list", ["--short"]);

    expect(vi.mocked(spawn).mock.calls).toEqual([
      ["list", ["--short"], { stdio: ["ignore", "pipe", "pipe"] }],
    ]);
  });

  it("passes the working directory and the whole environment through, and pipes the input to stdin", () => {
    const runner = new ProcessRunner();

    void runner.run("cat", [], {
      cwd: "/repo",
      env: { PATH: "/bin" },
      input: "hello",
    });

    expect(vi.mocked(spawn).mock.calls).toEqual([
      [
        "cat",
        [],
        {
          cwd: "/repo",
          env: { PATH: "/bin" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      ],
    ]);
    expect(child.stdin.end).toHaveBeenCalledWith("hello");
  });

  it("closes stdin without writing when no input is given", () => {
    const runner = new ProcessRunner();

    void runner.run("true", []);

    expect(child.stdin.end).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner: the result", () => {
  it("collects stdout and stderr in order and resolves with the exit code", async () => {
    const runner = new ProcessRunner();
    const result = runner.run("tool", []);

    child.stdout.emit("data", Buffer.from("a "));
    child.stdout.emit("data", Buffer.from("b"));
    child.stderr.emit("data", Buffer.from("oops"));
    child.emit("close", 3);

    await expect(result).resolves.toEqual({
      stdout: "a b",
      stderr: "oops",
      code: 3,
    });
  });

  it("resolves with code 1 when the child ends by signal and has no exit code", async () => {
    const runner = new ProcessRunner();
    const result = runner.run("tool", []);

    child.emit("close", null);

    await expect(result).resolves.toEqual({ stdout: "", stderr: "", code: 1 });
  });

  it("resolves with code 127 and the error message when the command cannot start", async () => {
    const runner = new ProcessRunner();
    const result = runner.run("missing", []);

    child.emit("error", new Error("spawn missing ENOENT"));

    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "spawn missing ENOENT",
      code: 127,
    });
  });
});

describe("ProcessRunner: the timeout", () => {
  it("kills a child that outlives its timeout and resolves with code 124 naming the timeout", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner();
    const result = runner.run("slow", [], { timeoutMs: 500 });

    child.stderr.emit("data", Buffer.from("partial "));
    vi.advanceTimersByTime(499);
    expect(child.kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    child.emit("close", null);

    await expect(result).resolves.toEqual({
      stdout: "",
      stderr: "partial timed out after 500 ms",
      code: 124,
    });
  });

  it("clears the timeout when the child exits in time, so nothing is killed later", async () => {
    vi.useFakeTimers();
    const runner = new ProcessRunner();
    const result = runner.run("quick", [], { timeoutMs: 500 });

    child.emit("close", 0);
    await result;

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner: a detached start", () => {
  it("spawns the child in its own process group with no pipes, and lets the parent exit without it", async () => {
    const runner = new ProcessRunner();
    const unref = vi.fn();
    Object.assign(child, { unref });

    await runner.run("poll", ["now"], { detached: true, cwd: "/repo" });

    expect(vi.mocked(spawn).mock.calls).toEqual([
      ["poll", ["now"], { cwd: "/repo", detached: true, stdio: "ignore" }],
    ]);
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("resolves at once with code 0 and no output, without waiting for the child to end", async () => {
    const runner = new ProcessRunner();
    Object.assign(child, { unref: vi.fn() });

    await expect(runner.run("poll", [], { detached: true })).resolves.toEqual({
      stdout: "",
      stderr: "",
      code: 0,
    });
  });

  it("absorbs a start error, so a command that cannot start never crashes the parent", () => {
    const runner = new ProcessRunner();
    Object.assign(child, { unref: vi.fn() });

    void runner.run("missing", [], { detached: true });

    expect(() => child.emit("error", new Error("ENOENT"))).not.toThrow();
  });
});
