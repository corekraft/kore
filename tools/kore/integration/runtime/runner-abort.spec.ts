import { describe, expect, it } from "vitest";
import { CommandError, ProcessRunner } from "../../src/runtime/index.js";

// Aborting a real child: the runner signals the process (or its group) and
// rejects with a CommandError. A long `sleep` stands in for a child that would
// otherwise run for half a minute.

describe("ProcessRunner: aborting a real child", () => {
  it("terminates a child at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new ProcessRunner().run("sleep", ["30"], { signal: controller.signal }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it("terminates a running child when the signal aborts mid-run", async () => {
    const controller = new AbortController();
    const result = new ProcessRunner().run("sleep", ["30"], {
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 50);

    await expect(result).rejects.toBeInstanceOf(CommandError);
  });

  it("terminates an uncaptured child, which has no group of its own", async () => {
    const controller = new AbortController();
    const result = new ProcessRunner().run("sleep", ["30"], {
      capture: false,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 50);

    await expect(result).rejects.toBeInstanceOf(CommandError);
  });

  it("terminates a captured child's whole group: its grandchild holds the output pipe, so it must be signalled too", async () => {
    const controller = new AbortController();
    const result = new ProcessRunner().run("sh", ["-c", "sleep 30 & wait"], {
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 50);

    await expect(result).rejects.toBeInstanceOf(CommandError);
  });

  it("lets a child that is never aborted run to completion", async () => {
    const controller = new AbortController();

    await expect(
      new ProcessRunner().run("sh", ["-c", "exit 0"], {
        signal: controller.signal,
      }),
    ).resolves.toEqual({ stdout: "", stderr: "", code: 0 });
  });
});
