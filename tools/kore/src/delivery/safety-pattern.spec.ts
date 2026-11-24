import { expect, test } from "vitest";
import { patternFailures, safetyTrailer } from "./safety-pattern.js";

test("the safety pattern is read from the Safety-pattern trailer of the head commit", () => {
  expect(
    safetyTrailer(
      "feat: add the eval runner\n\nSafety-pattern: feature-flagged\n",
    ),
  ).toBe("feature-flagged");
});

test("a head commit with no Safety-pattern trailer reads as no pattern", () => {
  expect(safetyTrailer("feat: add the eval runner\n")).toBeUndefined();
});

test("the trailer key is matched without regard to case", () => {
  expect(safetyTrailer("fix: a\n\nsafety-pattern: no-behaviour-change\n")).toBe(
    "no-behaviour-change",
  );
});

test("a commit with no trailer is refused, naming the four patterns to choose from", () => {
  expect(
    patternFailures({
      pattern: undefined,
      changedPaths: ["src/app.ts"],
      newFlags: [],
    }),
  ).toEqual([
    "the head commit has no Safety-pattern trailer; add one of no-behaviour-change, feature-flagged, dark-launched, expand-contract",
  ]);
});

test("a pattern outside the four is refused", () => {
  expect(
    patternFailures({
      pattern: "branch-by-abstraction",
      changedPaths: ["src/app.ts"],
      newFlags: [],
    }),
  ).toEqual([
    'Safety-pattern must be one of no-behaviour-change, feature-flagged, dark-launched, expand-contract; got "branch-by-abstraction"',
  ]);
});

test("a migration forces expand-contract, so a feature-flagged claim on it is refused", () => {
  expect(
    patternFailures({
      pattern: "feature-flagged",
      changedPaths: ["migrations/0002_add_column.sql", "src/app.ts"],
      newFlags: [],
    }),
  ).toEqual([
    "a migration under migrations/ needs the safety pattern expand-contract, not feature-flagged",
  ]);
});

test("a migration declared expand-contract is accepted", () => {
  expect(
    patternFailures({
      pattern: "expand-contract",
      changedPaths: ["migrations/0002_add_column.sql"],
      newFlags: [],
    }),
  ).toEqual([]);
});

test("a new flag forces feature-flagged, so a dark-launched claim on it is refused", () => {
  expect(
    patternFailures({
      pattern: "dark-launched",
      changedPaths: ["src/app.ts", "flags.yaml"],
      newFlags: ["leads.new-checkout"],
    }),
  ).toEqual([
    "a new flag (leads.new-checkout) needs the safety pattern feature-flagged, not dark-launched",
  ]);
});

test("a new flag declared feature-flagged is accepted", () => {
  expect(
    patternFailures({
      pattern: "feature-flagged",
      changedPaths: ["src/app.ts", "flags.yaml"],
      newFlags: ["leads.new-checkout"],
    }),
  ).toEqual([]);
});

test("no-behaviour-change is refused for any changed file that is neither a test nor a doc", () => {
  expect(
    patternFailures({
      pattern: "no-behaviour-change",
      changedPaths: ["src/app.ts", "docs/readme.md"],
      newFlags: [],
    }),
  ).toEqual([
    "no-behaviour-change allows only tests and docs; these changed files are not: src/app.ts",
  ]);
});

test("no-behaviour-change is accepted when every changed file is a test or a doc", () => {
  expect(
    patternFailures({
      pattern: "no-behaviour-change",
      changedPaths: [
        "tests/app.test.ts",
        "src/app.spec.ts",
        "README.md",
        "docs/decisions/0001-x.md",
        "tests/__tests__/helper.ts",
      ],
      newFlags: [],
    }),
  ).toEqual([]);
});

test("a feature-flagged claim is not forced where no new flag or migration changed", () => {
  expect(
    patternFailures({
      pattern: "feature-flagged",
      changedPaths: ["src/app.ts"],
      newFlags: [],
    }),
  ).toEqual([]);
});
