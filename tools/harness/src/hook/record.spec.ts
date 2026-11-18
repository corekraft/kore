import { describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import { hookCommand } from "./io.js";
import { recordCompaction } from "./compaction.js";
import { recordEvent } from "./ledger-event.js";
import { asksOwner } from "./owner-question.js";
import "./record.js";

vi.mock("./io.js");
vi.mock("./compaction.js");
vi.mock("./ledger-event.js");
vi.mock("./owner-question.js");

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

  it("records no session.start for a compaction, which continues the same session", async () => {
    await run({ source: "compact", session_id: "abc" });

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("counts a compact start as one compaction of the session, and a start with any other source as none", async () => {
    const payload = { source: "compact", session_id: "abc" };

    await run(payload);

    expect(recordCompaction).toHaveBeenCalledTimes(1);
    expect(recordCompaction).toHaveBeenCalledWith(DEPS, payload);
    vi.mocked(recordCompaction).mockClear();
    for (const source of ["startup", "clear", "resume", undefined, 3]) {
      await run({ source, session_id: "abc" });
    }
    expect(recordCompaction).not.toHaveBeenCalled();
  });

  it("starts no ledger poll for a compact start", async () => {
    runnerRun.mockReset();

    await run({ source: "compact", session_id: "abc" });

    expect(runnerRun).not.toHaveBeenCalled();
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

describe("record hook: questions put to the owner (#859)", () => {
  const readFile = vi.fn();
  const WITH_FS = asCliDeps({ tag: "deps-fs", fs: { readFile } });
  const TRANSCRIPT = "/home/jun/.claude/projects/kore/abc.jsonl";

  /** Runs the mode the way the host does, with the file system the mode reads its transcript through. */
  const runOwner = (payload: unknown, operand: string) =>
    handler({ deps: WITH_FS, payload, options: {}, operand });

  it("records owner.asked at a turn end whose final message asks the owner", async () => {
    const payload = { session_id: "abc", transcript_path: TRANSCRIPT };
    readFile.mockResolvedValue("the transcript text");
    vi.mocked(asksOwner).mockReturnValue(true);

    await runOwner(payload, "turn-end");

    expect(readFile).toHaveBeenCalledWith(TRANSCRIPT);
    expect(asksOwner).toHaveBeenCalledWith("the transcript text");
    expect(recordEvent).toHaveBeenCalledWith(WITH_FS, "owner.asked", payload);
  });

  it("records nothing at a turn end whose final message asks nothing", async () => {
    readFile.mockResolvedValue("the transcript text");
    vi.mocked(asksOwner).mockReturnValue(false);

    await runOwner(
      { session_id: "abc", transcript_path: TRANSCRIPT },
      "turn-end",
    );

    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records nothing and reads nothing at a turn end with no transcript path", async () => {
    await runOwner({ session_id: "abc" }, "turn-end");

    expect(readFile).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records nothing and prints nothing when the transcript cannot be read", async () => {
    readFile.mockRejectedValue(new Error("ENOENT"));

    expect(
      await runOwner(
        { session_id: "abc", transcript_path: TRANSCRIPT },
        "turn-end",
      ),
    ).toEqual({});
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("records owner.asked when the session calls AskUserQuestion", async () => {
    const payload = { session_id: "abc", tool_name: "AskUserQuestion" };

    await runOwner(payload, "owner-asked");

    expect(recordEvent).toHaveBeenCalledWith(WITH_FS, "owner.asked", payload);
  });

  it("records nothing for any other tool under the owner-asked mode", async () => {
    await runOwner({ session_id: "abc", tool_name: "Bash" }, "owner-asked");

    expect(recordEvent).not.toHaveBeenCalled();
  });
});

const GITHUB_POLL = [
  "node",
  ["/repo/skills/bin/harness.mjs", "ledger", "poll-github"],
  { detached: true },
];
const HERDR_POLL = [
  "node",
  ["/repo/skills/bin/harness.mjs", "ledger", "poll-herdr"],
  { detached: true },
];

describe("record hook: the background ledger polls", () => {
  it.each(["startup", "clear", "resume"])(
    "starts `ledger poll-github` then `ledger poll-herdr`, each detached through the runner, for a %s start",
    async (source) => {
      runnerRun.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

      await run({ source, session_id: "abc" });

      expect(runnerRun.mock.calls).toEqual([GITHUB_POLL, HERDR_POLL]);
    },
  );

  it("never issues a herdr command itself: the hook only starts the ledger poll", async () => {
    runnerRun.mockReset();
    runnerRun.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    await run({ source: "startup", session_id: "abc" });

    const commands = runnerRun.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("herdr");
  });
});

describe("record hook: background polls that fail or do not run", () => {
  it("still starts the herdr poll when the GitHub poll cannot start", async () => {
    runnerRun.mockReset();
    runnerRun.mockImplementationOnce(() => {
      throw new Error("spawn failed");
    });
    runnerRun.mockResolvedValue({ stdout: "", stderr: "", code: 0 });

    expect(await run({ source: "startup", session_id: "abc" })).toEqual({});
    expect(runnerRun.mock.calls).toEqual([GITHUB_POLL, HERDR_POLL]);
  });

  it("starts the herdr poll after a GitHub poll that rejects, so one failure does not stop the other", async () => {
    runnerRun.mockReset();
    runnerRun.mockImplementation((_command: string, args: string[]) =>
      args.includes("poll-github")
        ? Promise.reject(new Error("rate limited"))
        : Promise.resolve({ stdout: "", stderr: "", code: 0 }),
    );

    expect(await run({ source: "startup", session_id: "abc" })).toEqual({});
    expect(runnerRun.mock.calls).toEqual([GITHUB_POLL, HERDR_POLL]);
  });

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
