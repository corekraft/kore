import { describe, expect, it, vi } from "vitest";
import * as barrel from "./index.js";
import { IdeaRun } from "./idea-run.js";

vi.mock("./idea-run.js", () => ({ IdeaRun: vi.fn(), MAX_ROUNDS: 6 }));
vi.mock("./harness-cli.js", () => ({
  HarnessCli: vi.fn(),
  HarnessCliError: vi.fn(),
}));

describe("the orchestrator barrel", () => {
  it("exposes the domain's public names, and no file's internals", () => {
    expect(Object.keys(barrel).sort()).toEqual([
      "HarnessCli",
      "HarnessCliError",
      "IdeaRun",
      "MAX_ROUNDS",
    ]);
  });

  it("re-exports the unit's own class, not a copy", () => {
    expect(barrel.IdeaRun).toBe(IdeaRun);
  });
});
