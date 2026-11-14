import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  CommandError,
  CommandTimeoutError,
  ProcessRunner,
  type ProcessRunnerOptions,
} from "./runner.js";
import {
  FakeChild,
  FakeWatchdog,
  lastWatchdog,
} from "./runner-fakes-support.js";
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
let signalGroup: Mock<(pid: number, signal: Signal) => void>;

function runner(options: ProcessRunnerOptions = {}): ProcessRunner {
  return new ProcessRunner({
    spawn: spawn as unknown as NonNullable<ProcessRunnerOptions["spawn"]>,
    signalGroup,
    ...options,
  });
}

beforeEach(() => {
  FakeWatchdog.reset();
  child = new FakeChild();
  spawn = vi.fn<(...args: unknown[]) => FakeChild>(() => child);
  signalGroup = vi.fn<(pid: number, signal: Signal) => void>();
});

describe("ProcessRunner: starting the child", () => {
  it("spawns a captured child as the leader of its own group, with piped output and no stdin", () => {
    void runner().run("tool", ["run", "--fast"], { cwd: "/work" });

    expect(spawn).toHaveBeenCalledWith("tool", ["run", "--fast"], {
      cwd: "/work",
      env: process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("registers a detached child's group while it runs, and forgets it on exit", () => {
    void runner().run("tool", []);
    expect(liveGroups.add).toHaveBeenCalledWith(4242);

    child.emit("exit", 0);

    expect(liveGroups.delete).toHaveBeenCalledWith(4242);
    expect(lastWatchdog().exits).toBe(1);
  });

  it("passes an explicit environment through unchanged", () => {
    const env = { PATH: "/bin" };

    void runner().run("tool", [], { env });

    expect(spawn).toHaveBeenCalledWith(
      "tool",
      [],
      expect.objectContaining({ env }),
    );
  });

  it("lets an uncaptured child share the terminal, and does not give it a group", () => {
    void runner().run("tool", [], { capture: false });

    expect(spawn).toHaveBeenCalledWith("tool", [], {
      cwd: undefined,
      env: process.env,
      detached: false,
      stdio: ["ignore", "inherit", "inherit"],
    });
    expect(liveGroups.add).not.toHaveBeenCalled();
  });

  it("keeps an inherited stdin in the terminal's group rather than detaching the child", () => {
    void runner().run("tool", [], { stdin: "inherit" });

    expect(spawn).toHaveBeenCalledWith(
      "tool",
      [],
      expect.objectContaining({
        detached: false,
        stdio: ["inherit", "pipe", "pipe"],
      }),
    );
  });

  it("writes the input to stdin and closes it, with stdin piped", () => {
    void runner().run("tool", [], { input: "hello" });

    expect(spawn).toHaveBeenCalledWith(
      "tool",
      [],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(child.stdin.end).toHaveBeenCalledWith("hello");
  });
});

describe("ProcessRunner: the result", () => {
  it("resolves with the captured output on exit code 0, and stops the watchdog", async () => {
    const result = runner().run("tool", []);

    child.stdout.emit("data", Buffer.from("a "));
    child.stdout.emit("data", Buffer.from("b"));
    child.stderr.emit("data", Buffer.from("warn"));
    child.emit("close", 0);

    await expect(result).resolves.toEqual({
      stdout: "a b",
      stderr: "warn",
      code: 0,
    });
    expect(lastWatchdog().clears).toBe(1);
  });

  it("rejects with a CommandError naming the command, arguments and output on a failing exit", async () => {
    const result = runner().run("tool", ["run"]);

    child.stderr.emit("data", Buffer.from("  boom  \n"));
    child.emit("close", 2);

    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({
      command: "tool",
      args: ["run"],
      result: { stdout: "", stderr: "  boom  \n", code: 2 },
    });
    expect((error as Error).message).toBe("tool run failed (2): boom");
  });

  it("treats a child that closes with no exit code as failing with code 1", async () => {
    const result = runner().run("tool", []);

    child.emit("close", null);

    await expect(result).rejects.toMatchObject({ result: { code: 1 } });
  });

  it("rejects with the spawn error and stops the watchdog when the child cannot start", async () => {
    const result = runner().run("missing", []);
    const failure = new Error("spawn missing ENOENT");

    child.emit("error", failure);

    await expect(result).rejects.toBe(failure);
    expect(lastWatchdog().clears).toBe(1);
  });
});

describe("ProcessRunner: the timeout", () => {
  it("uses the call's own timeout over the runner default, and the default over none", () => {
    void runner({ defaultTimeoutMs: 9000 }).run("tool", [], { timeoutMs: 100 });
    expect(lastWatchdog().timeoutMs).toBe(100);

    void runner({ defaultTimeoutMs: 9000 }).run("tool", []);
    expect(lastWatchdog().timeoutMs).toBe(9000);

    void runner().run("tool", []);
    expect(lastWatchdog().timeoutMs).toBe(0);
  });

  it("uses the configured grace period before SIGKILL, defaulting to five seconds", () => {
    void runner({ killGraceMs: 250 }).run("tool", []);
    expect(lastWatchdog().options.graceMs).toBe(250);

    void runner().run("tool", []);
    expect(lastWatchdog().options.graceMs).toBe(5000);
  });

  it("rejects a timed-out run with a CommandTimeoutError naming the timeout and the last output", async () => {
    const result = runner().run("tool", ["run"], { timeoutMs: 1000 });
    const dog = lastWatchdog();

    child.stderr.emit("data", Buffer.from("x"));
    dog.expired = true;
    dog.killed = true;
    dog.options.settled();

    const error = await result.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CommandTimeoutError);
    expect(error).toMatchObject({ timeoutMs: 1000, escalatedToKill: true });
    expect((error as Error).message).toBe(
      "tool run timed out after 1000ms; it hung rather than failed, did not exit on SIGTERM, and was killed with SIGKILL. Check what it was waiting on, then rerun. Last output: x",
    );
    expect(child.stdout.destroy).toHaveBeenCalled();
    expect(child.stderr.destroy).toHaveBeenCalled();
  });

  it("names a timed-out child that stopped on SIGTERM, with no output tail when it printed none", async () => {
    const result = runner().run("tool", ["run"], { timeoutMs: 1000 });
    const dog = lastWatchdog();

    dog.expired = true;
    dog.options.settled();

    const error = await result.catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(
      "tool run timed out after 1000ms; it hung rather than failed, and stopped on SIGTERM. Check what it was waiting on, then rerun.",
    );
  });

  it("leaves a timed-out run to the watchdog when the child closes, rather than settling it early", async () => {
    let settledEarly = false;
    const result = runner()
      .run("tool", [])
      .then(
        () => (settledEarly = true),
        () => (settledEarly = true),
      );
    const dog = lastWatchdog();
    dog.expired = true;

    child.emit("close", 143);
    await Promise.resolve();

    expect(settledEarly).toBe(false);
    expect(dog.clears).toBe(0);
    dog.options.settled();
    await result;
    expect(settledEarly).toBe(true);
  });
});

describe("ProcessRunner: signalling the child", () => {
  it("signals a detached child's whole group through the group signaller", () => {
    void runner().run("tool", []);

    lastWatchdog().options.send("SIGKILL");

    expect(signalGroup).toHaveBeenCalledWith(4242, "SIGKILL");
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessRunner: a kubeconfig held in memory", () => {
  it("refuses a kubeconfig combined with stdin input, before starting anything", async () => {
    await expect(
      runner().run("kubectl", [], { kubeconfig: "k", input: "i" }),
    ).rejects.toThrow("a kubeconfig and stdin input cannot be combined");
    expect(spawn).not.toHaveBeenCalled();
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
