import { describe, expect, it } from "vitest";
import { decisionCommands } from "./decision-commands.js";
import * as help from "./decision-help.js";

// `decision route` is removed (plan 16 step 6, #1787). A pane's question goes to the owner with
// `decision ask`, and the advisor's decision is recorded with `decision make`; neither names route.
describe("the decision group without route", () => {
  it("registers no route command", () => {
    expect(decisionCommands["route"]).toBeUndefined();
  });

  it("names no decision route in the help of the commands that remain", () => {
    const make = decisionCommands["make"]?.help;
    expect(make?.whenNot).not.toContain("decision route");
    expect(make?.seeAlso ?? []).not.toContain("decision route");
    expect(help.askHelp.seeAlso ?? []).not.toContain("decision route");
  });
});
