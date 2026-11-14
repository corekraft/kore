import { describe, expect, it, vi } from "vitest";
import { harnessFreshness } from "./freshness.js";

const REPO = "corekraft/kore";
const STAMP = "abc1234";

describe("harnessFreshness", () => {
  it("compares the bundle's commit with main for tools/harness paths only", async () => {
    const api = vi.fn().mockResolvedValue("0\n");
    await harnessFreshness(api, REPO, STAMP);
    expect(api).toHaveBeenCalledWith([
      "api",
      `repos/${REPO}/compare/${STAMP}...main`,
      "--jq",
      '[.files[].filename | select(startswith("tools/harness/"))] | length',
    ]);
  });

  it("is current when main changed nothing under tools/harness since the bundle's commit", async () => {
    const api = vi.fn().mockResolvedValue("0\n");
    await expect(harnessFreshness(api, REPO, STAMP)).resolves.toEqual({
      state: "current",
    });
  });

  it("is behind, with an actionable message, when main changed tools/harness", async () => {
    const api = vi.fn().mockResolvedValue("3\n");
    await expect(harnessFreshness(api, REPO, STAMP)).resolves.toEqual({
      state: "behind",
      message: `The harness bundle (built at ${STAMP}) is behind origin/main: 3 files under tools/harness changed since. Update this worktree to origin/main, run \`mise run harness-build\`, then rerun the precheck.`,
    });
  });

  it("is unknown, not behind, when the bundle carries no commit stamp", async () => {
    const api = vi.fn();
    await expect(harnessFreshness(api, REPO, undefined)).resolves.toEqual({
      state: "unknown",
      message:
        "The harness bundle has no commit stamp, so it cannot be compared with origin/main. Rebuild it with `mise run harness-build`.",
    });
    expect(api).not.toHaveBeenCalled();
  });

  it("is unknown when GitHub cannot compare the commits", async () => {
    const api = vi.fn().mockRejectedValue(new Error("HTTP 404"));
    await expect(harnessFreshness(api, REPO, STAMP)).resolves.toEqual({
      state: "unknown",
      message: `Could not compare the harness bundle (${STAMP}) with origin/main: HTTP 404. Continuing without the freshness check.`,
    });
  });

  it("is unknown when GitHub answers something that is not a count", async () => {
    const api = vi.fn().mockResolvedValue("oops");
    const result = await harnessFreshness(api, REPO, STAMP);
    expect(result.state).toBe("unknown");
  });
});
