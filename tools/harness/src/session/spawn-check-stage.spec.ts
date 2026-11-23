import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTier, undefinedRoleError } from "./agent-definition.js";
import { contextOf, fakeDeps, type FakeDeps } from "./deps-support.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { sessionNameError } from "./names.js";
import { spawnLoadRefusal } from "./spawn-load.js";
import { checkRequest } from "./spawn-check.js";
import { launchStage, tierInputError, tierOf } from "./tier-source.js";
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
  vi.mocked(tierOf).mockResolvedValue({ tierSource: "definition" });
  vi.mocked(launchStage).mockReturnValue(undefined);
  vi.mocked(undefinedRoleError).mockResolvedValue(undefined);
  vi.mocked(resolveTier).mockResolvedValue({
    model: "claude-sonnet-5-5",
    effort: "high",
  });
});

describe("checkRequest carries the stage derived from the role", () => {
  it("returns the stage launchStage derives from the role and --pr", async () => {
    vi.mocked(launchStage).mockReturnValue("verify");

    const checked = await checkRequest(
      contextOf(deps, {
        options: { role: "reader", name: "x-reader", brief: "Go.", pr: "612" },
      }),
    );

    expect(launchStage).toHaveBeenCalledWith("reader", "612");
    expect(checked).toMatchObject({ stage: "verify" });
  });

  it("leaves the stage off when the role has none", async () => {
    const checked = await checkRequest(
      contextOf(deps, {
        options: { role: "reader", name: "x-reader", brief: "Go." },
      }),
    );

    expect(launchStage).toHaveBeenCalledWith("reader", undefined);
    expect(checked).not.toHaveProperty("stage");
  });
});
