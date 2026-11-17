import { describe, expect, it } from "vitest";
import { ownerCommands } from "./decision-owner-commands.js";

describe("the owner-facing decision commands", () => {
  it("offers ask and digest, and nothing else, so the group gains exactly these two commands", () => {
    expect(Object.keys(ownerCommands).sort()).toEqual(["ask", "digest"]);
  });

  it("gives each command a summary the usage text prints", () => {
    for (const command of Object.values(ownerCommands)) {
      expect(command.summary).toMatch(/^[a-z]/);
    }
  });
});
