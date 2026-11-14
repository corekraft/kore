import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTier } from "./agent-definition.js";
import { contextOf, fakeDeps } from "./deps-support.js";
import { USAGE_ERROR, fail } from "./output.js";
import { tier } from "./tier.js";

vi.mock("./agent-definition.js");
vi.mock("./output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./output.js")>()),
  fail: vi.fn(),
}));

const MISSING = "Missing the role: run `session tier <role>`.";

beforeEach(() => {
  // fail returns the code it is given, as the real one does, so tier's return value is observable.
  vi.mocked(fail).mockImplementation((_deps, _json, code) => code);
});

describe("tier", () => {
  it("fails with a usage error, without resolving anything, when no role is given", async () => {
    const deps = fakeDeps();

    const code = await tier(contextOf(deps));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledExactlyOnceWith(
      deps,
      false,
      USAGE_ERROR,
      MISSING,
    );
    expect(resolveTier).not.toHaveBeenCalled();
  });

  it("treats an empty role as missing", async () => {
    const deps = fakeDeps();

    const code = await tier(contextOf(deps, { operand: "" }));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledWith(deps, false, USAGE_ERROR, MISSING);
  });

  it("fails with the definition's own error when the role has no tier", async () => {
    const deps = fakeDeps();
    vi.mocked(resolveTier).mockResolvedValue({
      error: "No agent definition for reader.",
    });

    const code = await tier(contextOf(deps, { operand: "reader" }));

    expect(code).toBe(USAGE_ERROR);
    expect(fail).toHaveBeenCalledWith(
      deps,
      false,
      USAGE_ERROR,
      "No agent definition for reader.",
    );
  });

  it("prints the model and effort the role launches at, and exits 0", async () => {
    const deps = fakeDeps();
    vi.mocked(resolveTier).mockResolvedValue({
      model: "claude-opus-5-5",
      effort: "high",
    });

    const code = await tier(contextOf(deps, { operand: "writer" }));

    expect(code).toBe(0);
    expect(resolveTier).toHaveBeenCalledWith(deps, "writer", {});
    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      "writer: claude-opus-5-5, effort high\n",
    );
    expect(fail).not.toHaveBeenCalled();
  });

  it("prints one JSON object with the role, model and effort under --json", async () => {
    const deps = fakeDeps();
    vi.mocked(resolveTier).mockResolvedValue({
      model: "claude-opus-5-5",
      effort: "high",
    });

    await tier(contextOf(deps, { operand: "writer", json: true }));

    expect(deps.stdout).toHaveBeenCalledExactlyOnceWith(
      '{"role":"writer","model":"claude-opus-5-5","effort":"high"}\n',
    );
  });

  it("only reads the definition, so it runs no process and writes no file", async () => {
    const deps = fakeDeps();
    vi.mocked(resolveTier).mockResolvedValue({
      model: "claude-opus-5-5",
      effort: "high",
    });

    await tier(contextOf(deps, { operand: "writer" }));

    expect(deps.runner.run).not.toHaveBeenCalled();
    expect(deps.fs.writeFile).not.toHaveBeenCalled();
  });
});
