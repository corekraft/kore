// guide.ts declares types only; its contract is the compile-time shape that `tsc` checks.
import { describe, expectTypeOf, it } from "vitest";
import type { DomainGuide, RootFlow, RootGuide } from "./guide.js";

describe("the guide types", () => {
  it("a domain guide has a purpose, a usual flow and optional related commands", () => {
    expectTypeOf<DomainGuide>().toEqualTypeOf<{
      purpose: string;
      flow: string;
      seeAlso?: string[];
    }>();
  });

  it("the root guide has what the harness is, its flows as data, and how to go deeper", () => {
    expectTypeOf<RootGuide>().toEqualTypeOf<{
      what: string;
      flows: RootFlow[];
      deeper: string;
    }>();
    expectTypeOf<RootFlow>().toEqualTypeOf<{ name: string; steps: string[] }>();
  });
});
