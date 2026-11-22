import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessLineStream } from "./line-stream.js";

vi.mock("node:child_process");

/** A child process whose stdout is a real stream, so its lines are read as they arrive. */
class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new EventEmitter();
  readonly kill = vi.fn();
  exitCode: number | null = null;
  signalCode: string | null = null;

  asChildProcess(): ChildProcess {
    return this as unknown as ChildProcess;
  }

  /** The process prints text, then ends with a code, as a real one would. */
  end(code: number): void {
    this.stdout.end();
    this.exitCode = code;
    this.emit("close", code);
  }
}

let child: FakeChild;

beforeEach(() => {
  child = new FakeChild();
  vi.mocked(spawn).mockReturnValue(child.asChildProcess());
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Pulls the next line the stream yields, or resolves undefined when it has ended. */
async function next(
  stream: AsyncIterator<string>,
): Promise<string | undefined> {
  const step = await stream.next();
  return step.done === true ? undefined : step.value;
}

describe("ProcessLineStream: starting the child", () => {
  it("spawns the command with its arguments, cwd and environment, and reads stdout only", () => {
    const stream = new ProcessLineStream().lines("hc", ["events", "--json"], {
      cwd: "/repo",
      env: { HC_SESSION: "kore" },
    });

    void stream.next();

    expect(vi.mocked(spawn).mock.calls).toEqual([
      [
        "hc",
        ["events", "--json"],
        {
          cwd: "/repo",
          env: { HC_SESSION: "kore" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      ],
    ]);
  });
});

describe("ProcessLineStream: the lines", () => {
  it("yields each line as the child prints it, before the child has ended", async () => {
    const stream = new ProcessLineStream()
      .lines("hc", ["events"])
      [Symbol.asyncIterator]();

    const first = next(stream);
    child.stdout.write("one\ntwo\n");

    expect(await first).toBe("one");
    expect(await next(stream)).toBe("two");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("joins a line split across two writes, and yields a last line that has no newline", async () => {
    const stream = new ProcessLineStream()
      .lines("hc", ["events"])
      [Symbol.asyncIterator]();

    const first = next(stream);
    child.stdout.write("hel");
    child.stdout.write("lo\nwor");
    expect(await first).toBe("hello");
    const second = next(stream);
    child.end(0);

    expect(await second).toBe("wor");
    expect(await next(stream)).toBeUndefined();
  });

  it("ends without error when the child exits 0", async () => {
    const stream = new ProcessLineStream()
      .lines("hc", ["events"])
      [Symbol.asyncIterator]();

    const pending = next(stream);
    child.end(0);

    expect(await pending).toBeUndefined();
  });
});

describe("ProcessLineStream: a child that fails", () => {
  it("throws with the exit code and the child's own stderr when it exits non-zero", async () => {
    const stream = new ProcessLineStream()
      .lines("hc", ["events"])
      [Symbol.asyncIterator]();

    const pending = next(stream);
    child.stderr.emit("data", Buffer.from("no core\n"));
    child.end(3);

    await expect(pending).rejects.toThrow(
      "hc events ended with exit code 3: no core",
    );
  });

  it("throws the start error when the command cannot start", async () => {
    const stream = new ProcessLineStream()
      .lines("missing", [])
      [Symbol.asyncIterator]();

    const pending = next(stream);
    child.stdout.end();
    child.emit("error", new Error("spawn missing ENOENT"));

    await expect(pending).rejects.toThrow(
      "missing could not start: spawn missing ENOENT",
    );
  });
});

describe("ProcessLineStream: a command that ends normally", () => {
  it("does not kill a child whose output ends before its exit code is set, and waits for the code", async () => {
    const stream = new ProcessLineStream()
      .lines("hc", ["events"])
      [Symbol.asyncIterator]();

    const pending = next(stream);
    child.stdout.end();
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.kill).not.toHaveBeenCalled();

    child.exitCode = 0;
    child.emit("close", 0);

    expect(await pending).toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe("ProcessLineStream: stopping early", () => {
  it("kills the child when the reader stops before it ends, so no process outlives its reader", async () => {
    const stream = new ProcessLineStream()
      .lines("hc", ["events"])
      [Symbol.asyncIterator]();

    const first = next(stream);
    child.stdout.write("one\n");
    await first;
    await stream.return?.(undefined);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("leaves a child that has already exited alone", async () => {
    const stream = new ProcessLineStream()
      .lines("hc", ["events"])
      [Symbol.asyncIterator]();

    const pending = next(stream);
    child.end(0);
    await pending;
    await stream.return?.(undefined);

    expect(child.kill).not.toHaveBeenCalled();
  });
});
