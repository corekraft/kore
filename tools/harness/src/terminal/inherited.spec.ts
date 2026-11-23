import { describe, expect, it } from "vitest";
import { isInheritedFromCore } from "./inherited.js";

describe("isInheritedFromCore: a variable the core's start environment handed its terminals", () => {
  it("recognises a herdr variable, which a core started from a herdr pane passes down", () => {
    expect(isInheritedFromCore("HERDR_PANE_ID")).toBe(true);
    expect(isInheritedFromCore("HERDR_ENV")).toBe(true);
  });

  it("leaves hc's own variables and the caller's variables alone", () => {
    expect(isInheritedFromCore("HC_TERMINAL_ID")).toBe(false);
    expect(isInheritedFromCore("KORE_ROLE")).toBe(false);
    expect(isInheritedFromCore("PATH")).toBe(false);
  });

  it("matches the prefix exactly, in capitals, so a similar name is not taken", () => {
    expect(isInheritedFromCore("herdr_pane_id")).toBe(false);
    expect(isInheritedFromCore("KORE_HERDR_PANE")).toBe(false);
    expect(isInheritedFromCore("HERDR")).toBe(false);
  });
});
