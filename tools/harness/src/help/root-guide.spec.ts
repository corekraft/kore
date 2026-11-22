import { describe, expect, it } from "vitest";
import { rootGuide } from "./root-guide.js";

describe("the root guide", () => {
  it("has the three common flows as data, in order, each step a command the harness has", () => {
    expect(rootGuide.flows).toEqual([
      {
        name: "spawn, wait, close",
        steps: ["session spawn", "session wait", "session close"],
      },
      { name: "pr open, checks", steps: ["pr open", "pr checks"] },
      { name: "flag audit, activate", steps: ["flag audit", "flag activate"] },
    ]);
  });

  it("says what the harness is and how to go deeper, each in one line", () => {
    expect(rootGuide.what).not.toContain("\n");
    expect(rootGuide.deeper).not.toContain("\n");
  });
});
