import { describe, expect, it } from "vitest";
import { domainGuides } from "./domain-guides.js";

describe("the domain guides", () => {
  it("keep each purpose and each usual flow to one non-empty line", () => {
    for (const [domain, guide] of Object.entries(domainGuides)) {
      expect(guide.purpose.trim(), domain).not.toBe("");
      expect(guide.purpose, domain).not.toContain("\n");
      expect(guide.flow.trim(), domain).not.toBe("");
      expect(guide.flow, domain).not.toContain("\n");
    }
  });
});
