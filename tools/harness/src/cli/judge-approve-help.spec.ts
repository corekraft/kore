import { describe, expect, it } from "vitest";
import { approveHelp } from "./judge-approve-help.js";

describe("the judge approve help record", () => {
  it("describes its one flag, the reviewer logins, and no other", () => {
    expect(Object.keys(approveHelp.flags)).toEqual(["reviewer"]);
    expect(approveHelp.flags["reviewer"]).toContain("reviewerLogins");
  });

  it("gives exit codes 0, 1 and 2, in order", () => {
    expect(approveHelp.exits.map((exit) => exit.code)).toEqual([0, 1, 2]);
  });

  it("says the approval is a review posted only when the head is not already approved", () => {
    expect(approveHelp.effects.kind).toBe("mutates");
    expect(approveHelp.effects.detail).toContain(
      "posts one approving review on the PR",
    );
    expect(approveHelp.effects.detail).toContain(
      "only when this identity has not approved the verified head",
    );
  });

  it("gives only examples that run the approve command itself", () => {
    const others = approveHelp.examples
      .map((example) => example.command)
      .filter((command) => !command.startsWith("harness judge approve "));
    expect(others).toEqual([]);
  });
});
