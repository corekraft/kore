import { describe, expect, it } from "vitest";
import { hasNonLiteralLoad, importSpecifiers } from "./import-scan-support.js";

describe("importSpecifiers", () => {
  it.each([
    ['import { a } from "x";', "x"],
    ['export * from "x";', "x"],
    ['import "x";', "x"],
    ['await import("x")', "x"],
    ['require("x")', "x"],
    ['__require("x")', "x"],
    ["import 'x'", "x"],
  ])("finds the specifier in %s", (code, expected) => {
    expect(importSpecifiers(code)).toEqual([expected]);
  });

  it("flags a dynamic load whose specifier is not a literal", () => {
    expect(hasNonLiteralLoad("import(name)")).toBe(true);
    expect(hasNonLiteralLoad('import("x")')).toBe(false);
  });
});
