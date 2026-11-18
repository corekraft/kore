import { describe, expect, it } from "vitest";
import { codeLineCount } from "./code-lines.js";

// The count the lint's max-lines rule applies (skipBlankLines and skipComments): a line is
// counted when it holds code, including code that sits beside a trailing comment or inside
// a string or template literal.
describe("codeLineCount counts the lines the lint's max-lines rule counts", () => {
  it("skips blank lines and lines that hold only a // comment", () => {
    expect(codeLineCount("const a = 1;\n\n// a note\nconst b = 2;\n")).toBe(2);
  });

  it("skips every line of a block comment, including its * lines", () => {
    const source = [
      "/**",
      " * A doc block",
      " * over three lines.",
      " */",
      "export const a = 1;",
    ].join("\n");
    expect(codeLineCount(source)).toBe(1);
  });

  it("counts a line that holds code and then a block comment that opens and closes", () => {
    expect(codeLineCount("const a = 1; /* note */\n")).toBe(1);
  });

  it("counts the line where a block comment closes when code follows the close", () => {
    expect(codeLineCount("/* open\n still open */ const a = 1;\n")).toBe(1);
  });

  it("counts a line with code and a trailing // comment", () => {
    expect(codeLineCount("const a = 1; // the answer\n")).toBe(1);
  });

  it("treats // and /* inside a string literal as code, not as a comment", () => {
    const source = [
      'const url = "http://example.test";',
      "const open = '/* not a comment';",
      "const after = 3;",
    ].join("\n");
    expect(codeLineCount(source)).toBe(3);
  });

  it("does not let a quote inside a regex literal open a string", () => {
    const source = [
      'const re = /"/;',
      "const after = 3;",
      "const more = 4;",
    ].join("\n");
    expect(codeLineCount(source)).toBe(3);
  });

  it("counts every line of a template literal that holds text, and skips a whitespace-only one", () => {
    const source = [
      "const text = `first",
      "",
      "second`;",
      "const after = 1;",
    ].join("\n");
    expect(codeLineCount(source)).toBe(3);
  });

  it("counts a file with CRLF line endings the same as one with LF", () => {
    expect(
      codeLineCount("const a = 1;\r\n\r\n// note\r\nconst b = 2;\r\n"),
    ).toBe(2);
  });

  it("counts no lines for an empty source, and no extra line for a trailing newline", () => {
    expect(codeLineCount("")).toBe(0);
    expect(codeLineCount("const a = 1;")).toBe(1);
    expect(codeLineCount("const a = 1;\n")).toBe(1);
  });
});
