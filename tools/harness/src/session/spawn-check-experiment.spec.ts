import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CommandContext } from "../runtime/index.js";
import { resolveTier, undefinedRoleError } from "./agent-definition.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { sessionNameError } from "./names.js";
import { USAGE_ERROR } from "./output.js";
import { checkRequest } from "./spawn-check.js";
import {
  EXPERIMENT_EFFORT_ENV,
  EXPERIMENT_SHARE_ENV,
  EXPERIMENT_START,
  experimentConfigError,
} from "./spawn-experiment.js";
import { spawnLoadRefusal } from "./spawn-load.js";
import { tierInputError, tierOf } from "./tier-source.js";
import { parseTimeout } from "./wait.js";

vi.mock("./agent-definition.js");
vi.mock("./host-lease.js");
vi.mock("./names.js");
vi.mock("./spawn-load.js");
vi.mock("./tier-source.js");
vi.mock("./wait.js");

const WRITER = {
  role: "writer",
  name: "image-trust-writer",
  brief: "Do the thing.",
  worktree: true,
};

let deps: FakeDeps;
let random: Mock<() => number>;

/** A complete spawn request over the shared deps; a test overrides what it covers. */
function request(
  options: Record<string, string | boolean> = {},
): CommandContext {
  return contextOf(deps, { options: { ...WRITER, ...options } });
}

beforeEach(() => {
  deps = fakeDeps();
  deps.env = {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w3:p1",
    [EXPERIMENT_START]: "2026-12-01",
    [EXPERIMENT_EFFORT_ENV]: "high",
  };
  deps.clock.now.mockReturnValue(new Date("2026-12-02T00:00:00.000Z"));
  random = vi.fn<() => number>(() => 0.05);
  deps.random = random;
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(parseTimeout).mockReturnValue(60_000);
  vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
  vi.mocked(spawnLoadRefusal).mockReturnValue(undefined);
  vi.mocked(tierInputError).mockReturnValue(undefined);
  vi.mocked(tierOf).mockResolvedValue({ tierSource: "definition" });
  vi.mocked(undefinedRoleError).mockResolvedValue(undefined);
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-haiku-5-5",
    effort: "medium",
  });
});

describe("checkRequest samples a default-tier writer into the experiment window", () => {
  it("runs a sampled writer on Sonnet at the window effort, and records the experiment override", async () => {
    await expect(checkRequest(request())).resolves.toMatchObject({
      values: { model: "claude-sonnet-5-5", effort: "high" },
      tier: { tierSource: "override", tierReason: "experiment" },
    });
  });

  it("runs the control on the definition's model at the window effort, with the control marker", async () => {
    random.mockReturnValue(0.1);

    await expect(checkRequest(request())).resolves.toMatchObject({
      values: { model: "claude-haiku-5-5", effort: "high" },
      tier: { tierSource: "definition", tierReason: "experiment-control" },
    });
  });

  it("draws a writer launched with only an effort flag, and runs it at the window effort", async () => {
    vi.mocked(tierOf).mockResolvedValue({ tierSource: "override" });

    await expect(
      checkRequest(request({ effort: "low" })),
    ).resolves.toMatchObject({
      values: { model: "claude-sonnet-5-5", effort: "high" },
      tier: { tierSource: "override", tierReason: "experiment" },
    });
  });

  it("refuses a writer when the window is open and the window effort is unset, before any hc call", async () => {
    delete deps.env[EXPERIMENT_EFFORT_ENV];

    await expect(checkRequest(request())).resolves.toEqual({
      error: experimentConfigError(deps.env),
      code: USAGE_ERROR,
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });

  it("keeps the definition, and draws nothing, before the window opens", async () => {
    deps.clock.now.mockReturnValue(new Date("2026-11-30T23:59:59.999Z"));

    await expect(checkRequest(request())).resolves.toMatchObject({
      values: { model: "claude-haiku-5-5" },
      tier: { tierSource: "definition" },
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("keeps the definition, and draws nothing, when no window is configured", async () => {
    delete deps.env[EXPERIMENT_START];

    await expect(checkRequest(request())).resolves.toMatchObject({
      values: { model: "claude-haiku-5-5" },
      tier: { tierSource: "definition" },
    });
    expect(random).not.toHaveBeenCalled();
  });
});

describe("checkRequest keeps flag-chosen, reader and misconfigured launches on their own tier", () => {
  it("leaves a writer whose tier a flag chose on that flag's tier, and draws nothing", async () => {
    vi.mocked(tierOf).mockResolvedValue({
      tierSource: "override",
      tierReason: "deep diff",
    });

    await expect(
      checkRequest(request({ model: "claude-opus-5-5" })),
    ).resolves.toMatchObject({
      tier: { tierSource: "override", tierReason: "deep diff" },
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("leaves a reader on its definition, whatever the window and the draw", async () => {
    await expect(
      checkRequest(request({ role: "reader", worktree: false })),
    ).resolves.toMatchObject({
      values: { model: "claude-haiku-5-5" },
      tier: { tierSource: "definition" },
    });
    expect(random).not.toHaveBeenCalled();
  });

  it("refuses a writer whose window start is not a real date, before any hc call", async () => {
    deps.env = { ...deps.env, [EXPERIMENT_START]: "2026-02-30" };

    await expect(checkRequest(request())).resolves.toEqual({
      error: experimentConfigError(deps.env),
      code: USAGE_ERROR,
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("refuses a writer whose share or length the code would not read, before any hc call", async () => {
    deps.env = { ...deps.env, [EXPERIMENT_SHARE_ENV]: "1.5" };

    await expect(checkRequest(request())).resolves.toEqual({
      error: `${EXPERIMENT_SHARE_ENV} must be a share above 0 and up to 1, such as 0.1, or unset; got "1.5". No session was started.`,
      code: USAGE_ERROR,
    });
    expect(deps.runner.run).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
  });
});
