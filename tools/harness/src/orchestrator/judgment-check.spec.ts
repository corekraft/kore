import { describe, expect, it } from "vitest";
import {
  BRIEF_MAX,
  TEXT_MAX,
  checkPaths,
  fieldRefusal,
  isRecord,
  refuse,
  strayField,
  textProblem,
} from "./judgment-check.js";

const SUFFIX =
  "The whole plan is refused and nothing was started; fix the judgment pane's plan and rerun.";

describe("refuse and fieldRefusal", () => {
  it("ends a refusal with what the owner must do, and starts nothing", () => {
    expect(refuse("The plan is broken.")).toEqual({
      ok: false,
      error: `The plan is broken. ${SUFFIX}`,
    });
  });

  it("names the item and the field in a field refusal", () => {
    expect(
      fieldRefusal(
        "Plan reads item 1",
        "question",
        "give it a non-empty string",
      ),
    ).toEqual({
      ok: false,
      error: `Plan reads item 1 has field question: give it a non-empty string. ${SUFFIX}`,
    });
  });
});

describe("textProblem", () => {
  it("asks for a non-empty string when the value is blank or not text", () => {
    expect(textProblem(undefined, TEXT_MAX)).toBe("give it a non-empty string");
    expect(textProblem("   ", TEXT_MAX)).toBe("give it a non-empty string");
    expect(textProblem(7, TEXT_MAX)).toBe("give it a non-empty string");
  });

  it("asks for shortening over the cap, and passes text at the cap", () => {
    expect(textProblem("b".repeat(BRIEF_MAX + 1), BRIEF_MAX)).toBe(
      `it is over ${BRIEF_MAX} characters; shorten it`,
    );
    expect(textProblem("b".repeat(BRIEF_MAX), BRIEF_MAX)).toBeUndefined();
  });
});

describe("checkPaths", () => {
  it("accepts paths inside the repository and returns them as strings", () => {
    expect(checkPaths(["tools/harness/src/a.ts", "docs"])).toEqual({
      ok: true,
      paths: ["tools/harness/src/a.ts", "docs"],
    });
    expect(checkPaths([])).toEqual({ ok: true, paths: [] });
  });

  it("refuses a value that is not a list of paths", () => {
    expect(checkPaths("docs")).toEqual({
      ok: false,
      problem: "give it a list of paths",
    });
  });

  it("refuses a path that is blank or not a string", () => {
    expect(checkPaths(["  "])).toEqual({
      ok: false,
      problem: "give each path as a non-empty string",
    });
    expect(checkPaths([3])).toEqual({
      ok: false,
      problem: "give each path as a non-empty string",
    });
  });

  it("refuses a path that is absolute, home-relative, windows-style or climbs with ..", () => {
    for (const path of ["/etc/hosts", "~/.ssh/id", "docs\\x", "docs/../../x"]) {
      expect(checkPaths([path])).toEqual({
        ok: false,
        problem: `the path "${path}" is not inside the repository; use a path relative to the repository root`,
      });
    }
  });
});

describe("isRecord and strayField", () => {
  it("counts a plain object as a record, and an array or null as not", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it("names the first key an object has that the allowed list does not", () => {
    expect(strayField({ a: 1, b: 2 }, ["a"])).toBe("b");
    expect(strayField({ a: 1 }, ["a"])).toBeUndefined();
  });
});
