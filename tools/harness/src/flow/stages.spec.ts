import { describe, expect, it } from "vitest";
import {
  APPROVAL_LABEL,
  GITHUB_STAGES,
  MAIN_SESSION_STAGE,
  MIN_COMPLETED_IDEAS,
  ROLE_STAGES,
  STAGES,
} from "./stages.js";

describe("the delivery loop", () => {
  it("lists the stages in the order an idea passes through them", () => {
    expect(STAGES).toEqual([
      "refine",
      "challenge",
      "await approval",
      "orchestrate",
      "write",
      "judge",
      "merge",
      "verify",
      "outcome",
    ]);
  });
});

describe("the pane-role stage table", () => {
  it("names only loop stages", () => {
    for (const [, { stage }] of Object.entries(ROLE_STAGES)) {
      expect(STAGES).toContain(stage);
    }
  });

  it("holds only the verifier back until the pull request merged", () => {
    const gated = Object.entries(ROLE_STAGES)
      .filter(([, role]) => role.after !== undefined)
      .map(([name, role]) => [name, role.after]);
    expect(gated).toEqual([["verifier", "pr.merged"]]);
  });

  it("maps the verifier to verify and the writer to write", () => {
    expect(ROLE_STAGES.verifier).toEqual({
      stage: "verify",
      after: "pr.merged",
    });
    expect(ROLE_STAGES.writer).toEqual({ stage: "write" });
  });

  it("names no orchestrator or concierge pane, and leaves the orchestrate stage to the main session", () => {
    expect(Object.keys(ROLE_STAGES)).not.toContain("orchestrator");
    expect(Object.keys(ROLE_STAGES)).not.toContain("concierge");
    expect(MAIN_SESSION_STAGE).toBe("orchestrate");
  });
});

describe("the GitHub event stage table", () => {
  it("names only loop stages", () => {
    for (const [, stage] of Object.entries(GITHUB_STAGES)) {
      expect(STAGES).toContain(stage);
    }
  });

  it("leaves an issue label out, since only the approval label is a stage", () => {
    expect(Object.hasOwn(GITHUB_STAGES, "issue.labelled")).toBe(false);
  });
});

describe("the stage constants", () => {
  it("counts the approval label, the main session's stage and the minimum ideas", () => {
    expect(APPROVAL_LABEL).toBe("ready-for-agent");
    expect(MAIN_SESSION_STAGE).toBe("orchestrate");
    expect(MIN_COMPLETED_IDEAS).toBe(3);
  });
});
