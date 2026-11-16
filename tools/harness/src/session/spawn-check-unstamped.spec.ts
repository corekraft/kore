import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTier, undefinedRoleError } from "./agent-definition.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { sessionNameError } from "./names.js";
import { spawnLoadRefusal } from "./spawn-load.js";
import { check } from "./spawn-check.js";
import { launchStage, tierInputError, tierOf } from "./tier-source.js";
import { findResult, parseTimeout } from "./wait.js";

vi.mock("./agent-definition.js");
vi.mock("./host-lease.js");
vi.mock("./names.js");
vi.mock("./spawn-load.js");
vi.mock("./tier-source.js");
vi.mock("./wait.js");

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
  deps.env = { HERDR_ENV: "1", HERDR_PANE_ID: "w3:p1" };
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(findResult).mockReturnValue(undefined);
  vi.mocked(parseTimeout).mockReturnValue(60_000);
  vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
  vi.mocked(spawnLoadRefusal).mockReturnValue(undefined);
  vi.mocked(tierInputError).mockReturnValue(undefined);
  vi.mocked(tierOf).mockResolvedValue({ tierSource: "definition" });
  vi.mocked(launchStage).mockReturnValue(undefined);
  vi.mocked(undefinedRoleError).mockResolvedValue(undefined);
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-sonnet-5-5",
    effort: "high",
  });
});

/** The options of a spawn for `role`, with a worktree so a writer passes its own check. */
function spawnOf(
  role: string,
  extra: Record<string, string | boolean> = {},
): Record<string, string | boolean> {
  return { role, name: `x-${role}`, brief: "Go.", worktree: true, ...extra };
}

describe("check flags a required role spawned with no idea", () => {
  it.each(["writer", "judge", "principles-review"])(
    "marks a %s spawn with no --idea as unstamped, with no reason",
    async (role) => {
      const checked = await check(contextOf(deps, { options: spawnOf(role) }));

      expect(checked).toHaveProperty("unstamped", {});
    },
  );

  it("starts the spawn: the unstamped mark is not a refusal", async () => {
    const checked = await check(
      contextOf(deps, { options: spawnOf("writer") }),
    );

    expect(checked).toHaveProperty("values");
    expect(checked).not.toHaveProperty("error");
  });

  it("leaves a required role that names an idea unmarked", async () => {
    const checked = await check(
      contextOf(deps, { options: spawnOf("writer", { idea: "827" }) }),
    );

    expect(checked).not.toHaveProperty("unstamped");
  });

  it("leaves a reader with no idea unmarked, since an idea is optional for a reader", async () => {
    const checked = await check(
      contextOf(deps, {
        options: { role: "reader", name: "x-reader", brief: "Go." },
      }),
    );

    expect(checked).not.toHaveProperty("unstamped");
  });
});

describe("check records the reason a session gives with --no-idea", () => {
  it("carries the reason for a required role, so no warning is owed", async () => {
    const checked = await check(
      contextOf(deps, {
        options: spawnOf("writer", { "no-idea": "grilling session, no issue" }),
      }),
    );

    expect(checked).toHaveProperty("unstamped", {
      reason: "grilling session, no issue",
    });
  });

  it("carries the reason for a reader too, so its deliberate gap is told apart", async () => {
    const checked = await check(
      contextOf(deps, {
        options: {
          role: "reader",
          name: "x-reader",
          brief: "Go.",
          "no-idea": "analysis only",
        },
      }),
    );

    expect(checked).toHaveProperty("unstamped", { reason: "analysis only" });
  });

  it("refuses --idea together with --no-idea, and starts nothing", async () => {
    const checked = await check(
      contextOf(deps, {
        options: spawnOf("writer", { idea: "827", "no-idea": "none" }),
      }),
    );

    expect(checked).toEqual({
      error: "Use either --idea or --no-idea, not both.",
      code: 2,
    });
  });

  it.each([
    ["an empty reason", ""],
    ["a reason over 100 characters", "x".repeat(101)],
  ])("refuses %s, which the ledger would drop", async (_case, reason) => {
    const checked = await check(
      contextOf(deps, { options: spawnOf("writer", { "no-idea": reason }) }),
    );

    expect(checked).toEqual({
      error:
        "Invalid --no-idea. Use 1 to 100 characters with no control characters.",
      code: 2,
    });
  });

  it("accepts a reason of exactly 100 characters", async () => {
    const checked = await check(
      contextOf(deps, {
        options: spawnOf("writer", { "no-idea": "x".repeat(100) }),
      }),
    );

    expect(checked).toHaveProperty("unstamped", { reason: "x".repeat(100) });
  });
});
