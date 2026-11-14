import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps, CommandContext } from "../runtime/index.js";
import { delta } from "./delta-command.js";

const { update, realDeltaDeps } = vi.hoisted(() => ({
  update: vi.fn(),
  realDeltaDeps: vi.fn(),
}));
vi.mock("./delta.js", () => ({ update }));
vi.mock("./delta-deps.js", () => ({ realDeltaDeps }));

const ROOT = "/repo";
const DEPS = { tag: "deps" };

let stdout: ReturnType<typeof vi.fn>;
let stderr: ReturnType<typeof vi.fn>;

/** The one assertion: a fake's parts as CliDeps, whose members the spec never reads. */
const asCliDeps = (parts: object) => parts as CliDeps;

/** A context whose stdin carries the given text, as the host sends it. */
function contextWithStdin(text: string): CommandContext {
  stdout = vi.fn();
  stderr = vi.fn();
  const deps = asCliDeps({
    root: async () => ROOT,
    stdin: async () => text,
    stdout,
    stderr,
  });
  return { json: false, options: {}, deps };
}

beforeEach(() => {
  update.mockReset();
  realDeltaDeps.mockReset();
  realDeltaDeps.mockReturnValue(DEPS);
});

describe("delta hook: which sessions it answers", () => {
  it("writes nothing and does not compute a delta when the host sent no session id", async () => {
    const code = await delta.run(contextWithStdin(""));

    expect(code).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  it("refuses a session id with characters outside the safe set, and computes nothing", async () => {
    const code = await delta.run(
      contextWithStdin(JSON.stringify({ session_id: "a/../b" })),
    );

    expect(code).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });

  it("refuses a session id that is not a string", async () => {
    await delta.run(contextWithStdin(JSON.stringify({ session_id: 7 })));

    expect(update).not.toHaveBeenCalled();
  });
});

describe("delta hook: what it writes", () => {
  it("computes the delta for the session against the repository root and writes it as UserPromptSubmit context", async () => {
    update.mockResolvedValue("the plan changed");

    const code = await delta.run(
      contextWithStdin(JSON.stringify({ session_id: "abc-123_X" })),
    );

    expect(realDeltaDeps).toHaveBeenCalledWith(expect.anything(), ROOT);
    expect(update).toHaveBeenCalledWith("abc-123_X", DEPS);
    expect(code).toBe(0);
    expect(stdout).toHaveBeenCalledWith(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "the plan changed",
        },
      }),
    );
    expect(stderr).not.toHaveBeenCalled();
  });

  it("writes nothing when the delta is empty, so the agent gets no context", async () => {
    update.mockResolvedValue("");

    const code = await delta.run(
      contextWithStdin(JSON.stringify({ session_id: "abc" })),
    );

    expect(code).toBe(0);
    expect(stdout).not.toHaveBeenCalled();
  });
});
