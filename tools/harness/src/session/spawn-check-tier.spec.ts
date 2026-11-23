import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTier } from "./agent-definition.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { sessionNameError } from "./names.js";
import { USAGE_ERROR } from "./output.js";
import { spawnLoadRefusal } from "./spawn-load.js";
import { checkRequest } from "./spawn-check.js";
import { tierInputError, tierOf } from "./tier-source.js";
import { parseTimeout } from "./wait.js";

vi.mock("./agent-definition.js");
vi.mock("./host-lease.js");
vi.mock("./names.js");
vi.mock("./spawn-load.js");
vi.mock("./tier-source.js");
vi.mock("./wait.js");

let deps: FakeDeps;

beforeEach(() => {
  deps = fakeDeps();
  vi.mocked(sessionNameError).mockReturnValue(undefined);
  vi.mocked(parseTimeout).mockReturnValue(60_000);
  vi.mocked(hostLeaseRefusal).mockResolvedValue(undefined);
  vi.mocked(spawnLoadRefusal).mockReturnValue(undefined);
  vi.mocked(tierInputError).mockReturnValue(undefined);
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-sonnet-5-5",
    effort: "high",
  });
});

describe("checkRequest records where the tier came from", () => {
  const options = {
    role: "reader",
    name: "image-trust-writer",
    brief: "Do the thing.",
    pr: "612",
    reason: "deep diff",
  };

  it("returns the origin tierOf names for the flags as given", async () => {
    vi.mocked(tierOf).mockResolvedValue({
      tierSource: "override",
      tierReason: "deep diff",
    });
    const context = contextOf(deps, { options });

    await expect(checkRequest(context)).resolves.toMatchObject({
      tier: { tierSource: "override", tierReason: "deep diff" },
    });
    expect(tierOf).toHaveBeenCalledWith(deps, options);
  });

  it("refuses what tierInputError refuses, before any hc call or ledger read", async () => {
    vi.mocked(tierInputError).mockReturnValue("Invalid --pr.");

    await expect(checkRequest(contextOf(deps, { options }))).resolves.toEqual({
      error: "Invalid --pr.",
      code: USAGE_ERROR,
    });
    expect(tierOf).not.toHaveBeenCalled();
    expect(resolveTier).not.toHaveBeenCalled();
  });
});
