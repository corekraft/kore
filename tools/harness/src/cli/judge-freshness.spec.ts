import { describe, expect, it, vi } from "vitest";
import { harnessFreshness, JudgeError } from "../judge/index.js";
import { bundleCommit } from "./build-commit-support.js";
import { contextOf, REPO, ROOT } from "./judge-command-support.js";
import { requireFreshBundle } from "./judge-freshness.js";

vi.mock("../judge/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../judge/index.js")>()),
  harnessFreshness: vi.fn(),
}));
vi.mock("./build-commit-support.js");

describe("requireFreshBundle", () => {
  it("compares the bundle's own commit with main for the named repository", async () => {
    const { context, run } = contextOf("42");
    vi.mocked(bundleCommit).mockReturnValue("abc1234");
    vi.mocked(harnessFreshness).mockResolvedValue({ state: "current" });
    await requireFreshBundle(context, ROOT, REPO);
    expect(harnessFreshness).toHaveBeenCalledWith(
      expect.any(Function),
      REPO,
      "abc1234",
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the comparison through gh in the checkout, failing on a gh error", async () => {
    const { context, run } = contextOf("42");
    vi.mocked(harnessFreshness).mockResolvedValue({ state: "current" });
    await requireFreshBundle(context, ROOT, REPO);
    const api = vi.mocked(harnessFreshness).mock.calls[0]?.[0];
    run.mockResolvedValueOnce({ code: 0, stdout: "2\n", stderr: "" });
    await expect(api?.(["api", "x"])).resolves.toBe("2\n");
    expect(run).toHaveBeenCalledWith("gh", ["api", "x"], { cwd: ROOT });
    run.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "HTTP 404\n" });
    await expect(api?.(["api", "x"])).rejects.toThrow("HTTP 404");
  });

  it("throws the actionable message when the bundle is behind", async () => {
    const { context } = contextOf("42");
    vi.mocked(harnessFreshness).mockResolvedValue({
      state: "behind",
      message: "update it",
    });
    await expect(requireFreshBundle(context, ROOT, REPO)).rejects.toThrow(
      new JudgeError("update it"),
    );
  });

  it("only warns on stderr when the comparison is impossible", async () => {
    const { context, stderr } = contextOf("42");
    vi.mocked(harnessFreshness).mockResolvedValue({
      state: "unknown",
      message: "cannot compare",
    });
    await expect(
      requireFreshBundle(context, ROOT, REPO),
    ).resolves.toBeUndefined();
    expect(stderr).toHaveBeenCalledWith("warning: cannot compare\n");
  });

  it("says nothing when the bundle is current", async () => {
    const { context, stderr } = contextOf("42");
    vi.mocked(harnessFreshness).mockResolvedValue({ state: "current" });
    await requireFreshBundle(context, ROOT, REPO);
    expect(stderr).not.toHaveBeenCalled();
  });
});
