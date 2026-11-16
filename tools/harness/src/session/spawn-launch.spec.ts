import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTier, undefinedRoleError } from "./agent-definition.js";
import { fakeDeps, type FakeDeps } from "./deps-support.js";
import { launchOf } from "./spawn-launch.js";
import { writerExperiment } from "./spawn-experiment.js";
import { tierOf } from "./tier-source.js";

vi.mock("./agent-definition.js");
vi.mock("./spawn-experiment.js");
vi.mock("./tier-source.js");

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
  vi.mocked(undefinedRoleError).mockResolvedValue(undefined);
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-haiku-5-5",
    effort: "medium",
  });
  vi.mocked(tierOf).mockResolvedValue({ tierSource: "definition" });
  vi.mocked(writerExperiment).mockReturnValue(undefined);
});

describe("launchOf runs a launch on its definition or its flags", () => {
  it("returns the definition's model and effort with the origin tierOf names", async () => {
    await expect(launchOf(deps, "reader", {})).resolves.toEqual({
      model: "claude-haiku-5-5",
      effort: "medium",
      origin: { tierSource: "definition" },
    });
  });

  it("refuses an undefined role before any tier is resolved, so no flag can stand in for a definition", async () => {
    vi.mocked(undefinedRoleError).mockResolvedValue("Role verifier has none.");

    await expect(launchOf(deps, "verifier", {})).resolves.toEqual({
      error: "Role verifier has none.",
    });
    expect(resolveTier).not.toHaveBeenCalled();
  });

  it("refuses with the tier's error when the definition cannot supply a setting", async () => {
    vi.mocked(resolveTier).mockResolvedValue({ error: "No effort." });

    await expect(launchOf(deps, "reader", {})).resolves.toEqual({
      error: "No effort.",
    });
  });

  it("gives the flags the caller passed to the resolver, and nothing else", async () => {
    await launchOf(deps, "reader", {
      model: "claude-opus-5-5",
      effort: "high",
    });

    expect(resolveTier).toHaveBeenCalledWith(deps, "reader", {
      model: "claude-opus-5-5",
      effort: "high",
    });
  });
});

describe("launchOf applies the experiment window's sample to the launch", () => {
  it("runs a sampled writer on the experiment's model, keeping the definition's effort, with the experiment's origin", async () => {
    vi.mocked(writerExperiment).mockReturnValue({
      model: "claude-sonnet-5-5",
      tier: { tierSource: "override", tierReason: "experiment" },
    });

    await expect(launchOf(deps, "writer", {})).resolves.toEqual({
      model: "claude-sonnet-5-5",
      effort: "medium",
      origin: { tierSource: "override", tierReason: "experiment" },
    });
  });

  it("hands the window the role, the origin, the environment, the clock and the random source", async () => {
    await launchOf(deps, "writer", {});

    expect(writerExperiment).toHaveBeenCalledWith({
      role: "writer",
      origin: { tierSource: "definition" },
      env: deps.env,
      now: deps.clock.now.mock.results[0]?.value,
      random: deps.random,
    });
  });

  it("refuses a writer whose window is misconfigured, with the window's error", async () => {
    vi.mocked(writerExperiment).mockReturnValue({ error: "bad window" });

    await expect(launchOf(deps, "writer", {})).resolves.toEqual({
      error: "bad window",
    });
  });
});
