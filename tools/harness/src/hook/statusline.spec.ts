// The status line as a unit: the context figure, the line it builds from the
// plan helpers, and the hook's choice of project and fallback line. The plan
// domain, the hook wrapper and the plan reader are mocked. The real plan
// parsing and the bundle run are in integration/hook/statusline.spec.ts.
// Plan: infra/plans/3-agent-harness.md (Step 9)

import { beforeEach, describe, expect, it, vi } from "vitest";
import { activePlans, nextStep, openCounts, readPlans } from "../plan/index.js";
import type { CliDeps } from "../runtime/index.js";
import { hookCommand } from "./io.js";
import { contextPercent, statusLine } from "./statusline.js";
import "./statusline.js";

vi.mock("../plan/index.js");
vi.mock("./io.js", () => ({ hookCommand: vi.fn() }));

const AMBER = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

type Handler = Parameters<typeof hookCommand>[2];

/** The handler the wrapper registered when the module loaded, read before any reset. */
const registration = vi.mocked(hookCommand).mock.calls[0];
const handler = registeredHandler();

function registeredHandler(): Handler {
  if (registration === undefined) {
    throw new Error("the statusline hook was never registered");
  }
  return registration[2];
}

/** The one assertion: a fake whose members the spec never reads, beyond env and cwd. */
const asCliDeps = (parts: object) => parts as CliDeps;

const deps = (env: Record<string, string>, cwd = "/cwd") =>
  asCliDeps({ env, cwd });

const run = (payload: unknown, env: Record<string, string> = {}) =>
  handler({ deps: deps(env), payload, options: {}, operand: undefined });

beforeEach(() => {
  vi.mocked(activePlans).mockReturnValue([]);
  vi.mocked(nextStep).mockReturnValue(null);
  vi.mocked(openCounts).mockReturnValue([]);
  vi.mocked(readPlans).mockResolvedValue({});
});

describe("contextPercent", () => {
  it("prefers the reported percentage, rounded", () => {
    expect(contextPercent({ context_window: { used_percentage: 41.6 } })).toBe(
      42,
    );
  });

  it("falls back to the current usage over the window size", () => {
    expect(
      contextPercent({
        context_window: {
          context_window_size: 200000,
          current_usage: {
            input_tokens: 50000,
            cache_creation_input_tokens: 10000,
            cache_read_input_tokens: 40000,
          },
        },
      }),
    ).toBe(50);
  });

  it("reports null when neither the percentage nor a usable window is given", () => {
    expect(contextPercent({})).toBeNull();
    expect(
      contextPercent({
        context_window: { current_usage: { input_tokens: 1 } },
      }),
    ).toBeNull();
  });

  it("counts a missing usage field as zero", () => {
    expect(
      contextPercent({
        context_window: { context_window_size: 100, current_usage: {} },
      }),
    ).toBe(0);
  });
});

describe("statusLine", () => {
  it("joins context use, the plan name, its Next: step and open items", () => {
    vi.mocked(activePlans).mockReturnValue(["3-agent-harness.md"]);
    vi.mocked(nextStep).mockReturnValue({
      step: "Step 9: Operator Load",
      text: "wire it",
    });
    vi.mocked(openCounts).mockReturnValue([{ step: "Step 9", count: 2 }]);
    expect(
      statusLine(
        { context_window: { used_percentage: 12 } },
        { "3-agent-harness.md": "x" },
      ),
    ).toBe("ctx 12% · 3-agent-harness · Step 9 · 2 open");
  });

  it("sums open items across every step of the plan", () => {
    vi.mocked(activePlans).mockReturnValue(["2-plan.md"]);
    vi.mocked(openCounts).mockReturnValue([
      { step: "Step 1", count: 1 },
      { step: "Step 2", count: 3 },
    ]);
    expect(statusLine({}, { "2-plan.md": "markdown" })).toBe("2-plan · 4 open");
  });

  it("turns context use amber at 40% and red at 50%, and leaves it plain below", () => {
    const at = (used_percentage: number) =>
      statusLine({ context_window: { used_percentage } }, {});
    expect(at(39)).toBe("ctx 39%");
    expect(at(40)).toBe(`${AMBER}ctx 40%${RESET}`);
    expect(at(50)).toBe(`${RED}ctx 50%${RESET}`);
  });

  it("leaves out what it cannot know instead of guessing", () => {
    expect(statusLine({}, {})).toBe("");
    expect(vi.mocked(nextStep)).not.toHaveBeenCalled();
  });

  it("reads the first active plan only, and leaves Next: out when there is none", () => {
    vi.mocked(activePlans).mockReturnValue(["10-b.md", "2-a.md"]);
    vi.mocked(nextStep).mockReturnValue(null);
    vi.mocked(openCounts).mockReturnValue([{ step: "Step 1", count: 1 }]);
    expect(statusLine({}, { "10-b.md": "B", "2-a.md": "A" })).toBe(
      "10-b · 1 open",
    );
    expect(vi.mocked(nextStep)).toHaveBeenCalledWith("B");
  });

  it("keeps only the step name before the colon of Next:", () => {
    vi.mocked(activePlans).mockReturnValue(["4-tight.md"]);
    vi.mocked(nextStep).mockReturnValue({
      step: "Step 4: Tight",
      text: "do it",
    });
    vi.mocked(openCounts).mockReturnValue([{ step: "Step 1", count: 1 }]);
    expect(statusLine({}, { "4-tight.md": "m" })).toBe(
      "4-tight · Step 4 · 1 open",
    );
  });
});

describe("hook statusline, registration", () => {
  it("is registered under the name the host runs it by", () => {
    expect(registration?.[0]).toBe("statusline");
  });

  it("prints nothing for input that is not a JSON object", async () => {
    for (const payload of ["not json", undefined, [1], null, 7]) {
      expect(await run(payload)).toEqual({});
    }
    expect(vi.mocked(readPlans)).not.toHaveBeenCalled();
  });
});

describe("hook statusline, choice of project", () => {
  const used = (extra: object = {}) => ({
    context_window: { used_percentage: 20 },
    ...extra,
  });

  it("reads plans from CLAUDE_PROJECT_DIR first", async () => {
    await run(used({ workspace: { project_dir: "/ws" }, cwd: "/cwd" }), {
      CLAUDE_PROJECT_DIR: "/env",
    });
    const root = await vi.mocked(readPlans).mock.calls[0]?.[0].root();
    expect(root).toBe("/env");
  });

  it("then uses the host's workspace project, then the payload cwd", async () => {
    await run(used({ workspace: { project_dir: "/ws" }, cwd: "/cwd" }));
    expect(await vi.mocked(readPlans).mock.calls[0]?.[0].root()).toBe("/ws");
    vi.mocked(readPlans).mockClear();
    await run(used({ cwd: "/cwd" }));
    expect(await vi.mocked(readPlans).mock.calls[0]?.[0].root()).toBe("/cwd");
  });

  it("never falls back to the bundle's own repository when none is given", async () => {
    await run(used({ workspace: { project_dir: "" } }));
    expect(await vi.mocked(readPlans).mock.calls[0]?.[0].root()).toBe("/cwd");
  });
});

describe("hook statusline, output", () => {
  it("prints the line built from the plans it read, with a newline", async () => {
    vi.mocked(readPlans).mockResolvedValue({ "a.md": "markdown" });
    vi.mocked(activePlans).mockReturnValue(["a.md"]);
    vi.mocked(openCounts).mockReturnValue([{ step: "Step 1", count: 0 }]);
    expect(await run({ context_window: { used_percentage: 20 } })).toEqual({
      stdout: "ctx 20% · a · 0 open\n",
    });
  });

  it("prints nothing when the line is empty", async () => {
    expect(await run({})).toEqual({});
  });

  it("prints a short marker when the plans cannot be read, keeping the context figure", async () => {
    vi.mocked(readPlans).mockRejectedValue(new Error("EACCES"));
    expect(await run({ context_window: { used_percentage: 20 } })).toEqual({
      stdout: "ctx 20% · plans?\n",
    });
  });

  it("prints only the marker when the plans cannot be read and no context is known", async () => {
    vi.mocked(readPlans).mockRejectedValue(new Error("EACCES"));
    expect(await run({})).toEqual({ stdout: "plans?\n" });
  });
});
