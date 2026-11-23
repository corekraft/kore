import { describe, expect, it } from "vitest";
import { ownerCommands } from "./decision-owner-commands.js";

describe("the owner-facing decision commands", () => {
  it("offers ask, and nothing else: decision digest is removed (#1787), so the group gains only ask", () => {
    expect(Object.keys(ownerCommands).sort()).toEqual(["ask"]);
  });

  it("gives each command a summary the usage text prints", () => {
    for (const command of Object.values(ownerCommands)) {
      expect(command.summary).toMatch(/^[a-z]/);
    }
  });
});
