import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { hookCommand } from "./io.js";
import { recordEvent } from "./ledger-event.js";
import "./record.js";

vi.mock("./io.js");
vi.mock("./ledger-event.js");

/** The one assertion: a fake whose members the spec never reads, passed through to the mocked ledger. */
const asCliDeps = (parts: object) => parts as CliDeps;
const DEPS = asCliDeps({ tag: "deps" });

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
