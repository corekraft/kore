import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  CommandError,
  ProcessRunner,
  RecordingRunner,
  withSignal,
  type ProcessRunnerOptions,
} from "./runner.js";
import { FakeChild, FakeWatchdog } from "./runner-fakes-support.js";
import type { Signal } from "./watchdog.js";

vi.mock("./watchdog.js", async () => ({
  Watchdog: (await import("./runner-fakes-support.js")).FakeWatchdog,
}));

const { liveGroups, killGroup } = vi.hoisted(() => ({
  liveGroups: {
    add: vi.fn<(pid: number) => void>(),
    delete: vi.fn<(pid: number) => void>(),
  },
  killGroup: vi.fn<(pid: number, signal: Signal) => void>(),
}));
vi.mock("./live-groups.js", () => ({ liveGroups, killGroup }));

let child: FakeChild;
let spawn: Mock<(...args: unknown[]) => FakeChild>;

function runner(options: ProcessRunnerOptions = {}): ProcessRunner {
  return new ProcessRunner({
    spawn: spawn as unknown as NonNullable<ProcessRunnerOptions["spawn"]>,
    ...options,
  });
}

beforeEach(() => {
  FakeWatchdog.reset();
  liveGroups.add.mockReset();
  liveGroups.delete.mockReset();
  killGroup.mockReset();
  child = new FakeChild();
  spawn = vi.fn<(...args: unknown[]) => FakeChild>(() => child);
});

describe("ProcessRunner: a kubeconfig held in memory", () => {
  it("refuses a kubeconfig combined with stdin input, before starting anything", async () => {
    await expect(
      runner().run("kubectl", [], { kubeconfig: "k", input: "i" }),
    ).rejects.toThrow("a kubeconfig and stdin input cannot be combined");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("feeds the kubeconfig through bash on a pipe, and resolves with the child's output", async () => {
    const result = runner().run("kubectl", ["get", "pods"], {
      kubeconfig: "apiVersion: v1",
    });

    expect(spawn).toHaveBeenCalledWith(
      "bash",
      ["-c", 'KUBECONFIG=<(cat) exec "$0" "$@"', "kubectl", "get", "pods"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(child.stdin.end).toHaveBeenCalledWith("apiVersion: v1");

    child.stdout.emit("data", Buffer.from("ok"));
    child.emit("close", 0);

    await expect(result).resolves.toEqual({
      stdout: "ok",
      stderr: "",
      code: 0,
    });
  });

  it("reports bash's not-found failure as the caller's command missing, with ENOENT", async () => {
    const result = runner().run("kubectl", ["get"], { kubeconfig: "k" });

    child.stderr.emit("data", Buffer.from("bash: kubectl: command not found"));
    child.emit("close", 127);

    await expect(result).rejects.toMatchObject({
      message: "spawn kubectl ENOENT",
      code: "ENOENT",
      errno: -2,
      syscall: "spawn kubectl",
      path: "kubectl",
    });
  });

  it("rewraps any other failure as the caller's own command, not bash's", async () => {
    const result = runner().run("kubectl", ["apply"], { kubeconfig: "k" });

    child.stderr.emit("data", Buffer.from("forbidden"));
    child.emit("close", 1);

    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as Error).message).toBe(
      "kubectl apply failed (1): forbidden",
    );
  });

  it("passes a spawn error through unchanged, since it is not a command failure", async () => {
    const result = runner().run("kubectl", [], { kubeconfig: "k" });
    const failure = new Error("spawn bash EACCES");

    child.emit("error", failure);

    await expect(result).rejects.toBe(failure);
  });
});

describe("RecordingRunner and withSignal", () => {
  it("records each call and answers from its queue, then with exit code 0", async () => {
    const recorder = new RecordingRunner([
      { stdout: "first", stderr: "", code: 3 },
    ]);

    await expect(recorder.run("a", ["1"])).resolves.toEqual({
      stdout: "first",
      stderr: "",
      code: 3,
    });
    await expect(recorder.run("b", [], { cwd: "/x" })).resolves.toEqual({
      stdout: "",
      stderr: "",
      code: 0,
    });

    expect(recorder.calls).toEqual([
      { command: "a", args: ["1"] },
      { command: "b", args: [], options: { cwd: "/x" } },
    ]);
  });

  it("gives every command run through the wrapper the same abort signal", async () => {
    const inner = new RecordingRunner();
    const controller = new AbortController();

    await withSignal(inner, controller.signal).run("a", [], { cwd: "/x" });

    expect(inner.calls).toEqual([
      {
        command: "a",
        args: [],
        options: { cwd: "/x", signal: controller.signal },
      },
    ]);
  });
});
