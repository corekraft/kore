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

  it("holds a guide for every domain of the table: a record with none is a compile error", () => {
    // @ts-expect-error the guides are keyed by the table's domains, so an empty record misses every one
    const none: typeof domainGuides = {};
    expect(Object.keys(none)).toEqual([]);
  });
});
