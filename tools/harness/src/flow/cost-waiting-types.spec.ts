import { describe, expect, it } from "vitest";
import { AGENT_ROLES } from "./cost-waiting-types.js";

describe("cost beside waiting types: the roles a session can carry", () => {
  it("names exactly the roles the per-agent rows print, in their order", () => {
    expect(AGENT_ROLES).toEqual([
      "writer",
      "reviewer",
      "judge",
      "verifier",
      "reader",
      "judgment",
      "advisor",
    ]);
  });
});
