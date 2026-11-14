// The context hook's command: what it reads from the host, what it prints, and
// which faults it lets fail. The hook wrapper, the restore and the real
// dependencies are mocked; the handler is the one the wrapper registered.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliDeps } from "../runtime/index.js";
import "./context-command.js";
import { realContextDeps } from "./context-deps.js";
import { restore } from "./context.js";
import { deps as contextDeps } from "./context-support.js";
import { hookCommand } from "./io.js";

vi.mock("./io.js", () => ({ hookCommand: vi.fn() }));
vi.mock("./context.js", () => ({ restore: vi.fn() }));
vi.mock("./context-deps.js", () => ({ realContextDeps: vi.fn() }));

type Handler = Parameters<typeof hookCommand>[2];

/** The handler the wrapper registered when the module loaded, as the wrapper typed it. */
function registeredHandler(): Handler {
  const handler = vi.mocked(hookCommand).mock.calls[0]?.[2];
  if (!handler) {
    throw new Error("the context hook was never registered");
  }
  return handler;
}

/** The one assertion: a fake's parts as CliDeps, whose members the spec never reads. */
const asCliDeps = (parts: object) => parts as CliDeps;

/** A host's CliDeps reduced to what the handler reads: the repository root. The one cast stands for the rest. */
function fakeDeps(): CliDeps {
  return asCliDeps({ root: () => Promise.resolve("/repo") });
}

// The wrapper is automocked, so its calls are read at load, before any test resets the mocks.
const registeredName = vi.mocked(hookCommand).mock.calls[0]?.[0];
const handler = registeredHandler();
const deps = fakeDeps();
const rootedDeps = contextDeps();

/** The hook context the wrapper hands the handler for a payload, with no flags or operand. */
const run = (payload: unknown) =>
  handler({ deps, payload, options: {}, operand: undefined });

beforeEach(() => {
  vi.mocked(realContextDeps).mockReturnValue(rootedDeps);
  vi.mocked(restore).mockResolvedValue("");
});

describe("context command, input", () => {
  it("is registered under the name the host runs it by", () => {
    expect(registeredName).toBe("context");
  });

  it("ends quietly on input that is not a JSON object", async () => {
    expect(await run("text")).toEqual({});
    expect(await run(null)).toEqual({});
    expect(await run(["list"])).toEqual({});
    expect(vi.mocked(restore)).not.toHaveBeenCalled();
  });
});

describe("context command, output", () => {
  it("prints nothing when there is no context to add", async () => {
    expect(await run({ source: "resume" })).toEqual({});
  });

  it("prints the context as SessionStart additional context", async () => {
    vi.mocked(restore).mockResolvedValue(
      "Session brief from infra/plans/x.md:",
    );
    expect(await run({ source: "startup" })).toEqual({
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: "Session brief from infra/plans/x.md:",
        },
      }),
    });
  });

  it("restores from the event and the dependencies rooted at the repository", async () => {
    await run({ source: "compact", session_id: "s1" });
    expect(vi.mocked(realContextDeps).mock.calls).toEqual([[deps, "/repo"]]);
    expect(vi.mocked(restore).mock.calls).toEqual([
      [{ source: "compact", session_id: "s1" }, rootedDeps],
    ]);
  });
});

describe("context command, faults", () => {
  it("ends quietly when AGENTS.md is missing", async () => {
    vi.mocked(restore).mockRejectedValue(
      Object.assign(new Error("no AGENTS.md"), { code: "ENOENT" }),
    );
    expect(await run({ source: "compact" })).toEqual({});
  });

  it("rethrows any other fault, so a broken hook is visible", async () => {
    vi.mocked(restore).mockRejectedValue(new Error("plan parse broke"));
    await expect(run({ source: "compact" })).rejects.toThrow(
      "plan parse broke",
    );
  });
});
