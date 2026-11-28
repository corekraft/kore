// Docs: docs/decisions/0077-live-proof-gates-activation-not-merge.md
import { describe, expect, it, vi } from "vitest";
import { flagCommands } from "./flag-commands.js";

vi.mock("./flag-activate-command.js", () => ({
  activate: { summary: "activate" },
}));
vi.mock("./flag-audit-command.js", () => ({ audit: { summary: "audit" } }));
vi.mock("./flag-progress-command.js", () => ({
  progress: { summary: "progress" },
}));
vi.mock("./flag-retire-command.js", () => ({
  retire: { summary: "retire" },
}));

describe("flag command table", () => {
  it("names the activate, audit, progress and retire commands, each from its own module", () => {
    expect(flagCommands).toEqual({
      activate: { summary: "activate" },
      audit: { summary: "audit" },
      progress: { summary: "progress" },
      retire: { summary: "retire" },
    });
  });
});
