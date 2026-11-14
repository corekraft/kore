import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { hookCommand } from "./io.js";
import { recordEvent } from "./ledger-event.js";
import "./record.js";

vi.mock("./io.js");
vi.mock("./ledger-event.js");

/** The one assertion: a fake whose members the spec never reads, passed through to the mocked ledger. */
const asCliDeps = (parts: object) => parts as CliDeps;
const BUNDLE = "file:///repo/skills/bin/harness.mjs";
const runnerRun = vi.fn();
const DEPS = asCliDeps({
  tag: "deps",
  bundleUrl: BUNDLE,
  runner: { run: runnerRun },
});

/** The handler `record` was built from, read from the hookCommand call that ran when the module loaded. */
function handlerOf() {
  const call = vi.mocked(hookCommand).mock.calls.at(0);
  if (call === undefined) {
    throw new Error("record did not build its hook with hookCommand");
  }
  return call[2];
}
const handler = handlerOf();

/** Runs the hook as the host does: the payload from stdin, and the mode as the operand, or none. */
function runMode(payload: unknown, operand: string | undefined) {
  return handler({ deps: DEPS, payload, options: {}, operand });
}

/** Runs the hook as SessionStart wires it: the session-start mode. */
const run = (payload: unknown) => runMode(payload, "session-start");

describe("record hook: which session starts it records", () => {
  it.each(["startup", "clear", "resume"])(
    "records a session.start for a %s start",
    async (source) => {
      const payload = { source, session_id: "abc" };

      await run(payload);

      expect(recordEvent).toHaveBeenCalledWith(DEPS, "session.start", payload);
    },
  );

  it("records nothing for a compaction, which continues the same session", async () => {
    await run({ source: "compact", session_id: "abc" });

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records nothing when the source is missing or not a string", async () => {
    await run({ session_id: "abc" });
    await run({ source: 3, session_id: "abc" });

    expect(recordEvent).not.toHaveBeenCalled();
  });
});

describe("record hook: what it ignores", () => {
  it("records nothing and prints nothing when the host sent no payload", async () => {
    expect(await run(undefined)).toEqual({});
    expect(await run(null)).toEqual({});
    expect(await run("startup")).toEqual({});
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records nothing under any mode other than session-start", async () => {
    await runMode({ source: "startup" }, "stop");
    await runMode({ source: "startup" }, undefined);

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("returns no output, so the host gets nothing back from the hook", async () => {
    expect(await run({ source: "startup" })).toEqual({});
  });
});

describe("record hook: the background ledger poll", () => {
  const POLL = [
    "node",
    ["/repo/skills/bin/harness.mjs", "ledger", "poll-github"],
    { detached: true },
  ];

  it.each(["startup", "clear", "resume"])(
    "starts `ledger poll-github` detached through the runner for a %s start",
    async (source) => {
      runnerRun.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

      await run({ source, session_id: "abc" });

      expect(runnerRun.mock.calls).toEqual([POLL]);
    },
  );

  it("prints nothing into the session context when the poll reports output or fails", async () => {
    runnerRun.mockResolvedValue({ stdout: "polled", stderr: "rate", code: 1 });

    expect(await run({ source: "startup", session_id: "abc" })).toEqual({});
  });

  it("swallows a poll that rejects, so no unhandled rejection reaches the host", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    runnerRun.mockRejectedValue(new Error("rate limited"));

    expect(await run({ source: "resume", session_id: "abc" })).toEqual({});
    await new Promise((resolve) => setImmediate(resolve));
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });

  it("returns the same output when the runner throws at once", async () => {
    runnerRun.mockImplementation(() => {
      throw new Error("spawn failed");
    });

    expect(await run({ source: "clear", session_id: "abc" })).toEqual({});
  });

  it("starts no poll for a compaction, another mode or a missing bundle", async () => {
    await run({ source: "compact", session_id: "abc" });
    await runMode({ source: "startup" }, "stop");
    await handler({
      deps: asCliDeps({ runner: { run: runnerRun } }),
      payload: { source: "startup" },
      options: {},
      operand: "session-start",
    });

    expect(runnerRun).not.toHaveBeenCalled();
  });
});
