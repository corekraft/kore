// The string literals of a TypeScript source file, read for the harness commands their text names.
// Docs: infra/plans/17-harness-help-guide.md#step-1-help-guide

import { expect, test } from "vitest";
import { sourceTexts } from "./source-texts.js";

test("each quoted literal is read with the line it starts on", () => {
  expect(
    sourceTexts(['const a = "x";', "const b = 'y';", ""].join("\n")),
  ).toEqual([
    { line: 1, text: "x" },
    { line: 2, text: "y" },
  ]);
});

test("a template literal runs over its lines, and the next literal is counted from the line it ends on", () => {
  const source = ["const a = `x", "y`;", 'const b = "z";'].join("\n");
  expect(sourceTexts(source)).toEqual([
    { line: 1, text: "x\ny" },
    { line: 3, text: "z" },
  ]);
});

test("a comment is never read as a literal, and the lines it spans are counted", () => {
  const source = [
    '// "not" a literal',
    "/* 'nor' this",
    "one */",
    '"yes"',
  ].join("\n");
  expect(sourceTexts(source)).toEqual([{ line: 4, text: "yes" }]);
});

test("a slash that divides is not taken for a comment", () => {
  expect(sourceTexts(["const c = a / b;", '"after"'].join("\n"))).toEqual([
    { line: 2, text: "after" },
  ]);
});

test("an escaped quote is read as the quote it stands for", () => {
  expect(sourceTexts(String.raw`"say \"hi\" and a\\b"`)).toEqual([
    { line: 1, text: 'say "hi" and a\\b' },
  ]);
});

test("an \\n or \\t escape is read as a space, so a word does not run into the next", () => {
  expect(sourceTexts(String.raw`"run harness pr check\nthen"`)).toEqual([
    { line: 1, text: "run harness pr check then" },
  ]);
});

test("an escaped backtick is read as a backtick, so a code span inside a template literal reads whole", () => {
  expect(sourceTexts("`run \\`harness pr check\\``")).toEqual([
    { line: 1, text: "run `harness pr check`" },
  ]);
});

test("a quote that is never closed ends at its own line", () => {
  expect(sourceTexts(['"abc', 'const d = "ok";'].join("\n"))).toEqual([
    { line: 1, text: "abc" },
    { line: 2, text: "ok" },
  ]);
});

test("an empty literal is read as empty text", () => {
  expect(sourceTexts('""')).toEqual([{ line: 1, text: "" }]);
});

test("a template's interpolation is kept as the text it is written as", () => {
  expect(sourceTexts("`a ${b} c`")).toEqual([{ line: 1, text: "a ${b} c" }]);
});
