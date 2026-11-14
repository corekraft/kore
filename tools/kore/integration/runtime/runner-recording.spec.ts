import { describe, expect, it } from "vitest";
import { RecordingRunner, withSignal } from "../../src/runtime/index.js";

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
