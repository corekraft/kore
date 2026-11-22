import { describe, expect, it } from "vitest";
import { harnessMentions } from "./current-docs.js";

describe("harnessMentions", () => {
  it("reads the domain and command a code span names, with its line", () => {
    expect(harnessMentions("Run `harness pr check <pr>` now.")).toEqual([
      { line: 1, words: ["pr", "check"], flags: [] },
    ]);
  });

  it("lists the flags a command line names, and never --help", () => {
    expect(
      harnessMentions(
        "`node skills/bin/harness.mjs pr open --title <t> --body-file <p>`",
      ),
    ).toEqual([
      { line: 1, words: ["pr", "open"], flags: ["title", "body-file"] },
    ]);
    expect(harnessMentions("`harness pr open --help`")).toEqual([
      { line: 1, words: ["pr", "open"], flags: [] },
    ]);
  });

  it("reads each line of a fenced block as code, with its own line number", () => {
    const text =
      "Intro.\n\n```bash\nnode skills/bin/harness.mjs flow report --json\n```";
    expect(harnessMentions(text)).toEqual([
      { line: 4, words: ["flow", "report"], flags: ["json"] },
    ]);
  });

  it("reads each command of a span that chains two, so a flag belongs to the command it follows", () => {
    expect(
      harnessMentions(
        "`harness plan tick --plan 1 && harness plan next --text x`",
      ),
    ).toEqual([
      { line: 1, words: ["plan", "tick"], flags: ["plan"] },
      { line: 1, words: ["plan", "next"], flags: ["text"] },
    ]);
  });

  it("ignores a path that merely contains harness, and a flag that comes before it", () => {
    expect(
      harnessMentions(
        "`bash tools/harness/wizards/identities.sh --transfer x`",
      ),
    ).toEqual([]);
    expect(
      harnessMentions("`npm --prefix tools/harness exec vitest run`"),
    ).toEqual([]);
  });

  it("ignores harness as the value of a flag, as in --kind harness", () => {
    expect(
      harnessMentions(
        "`node skills/bin/harness.mjs idea new --kind harness --title x`",
      ),
    ).toEqual([{ line: 1, words: ["idea", "new"], flags: ["kind", "title"] }]);
  });

  it("reads at most two words after harness, the domain and the command", () => {
    expect(harnessMentions("`harness plan tick now later`")).toEqual([
      { line: 1, words: ["plan", "tick"], flags: [] },
    ]);
  });

  it("names a call with no words when harness stands alone with --help", () => {
    expect(harnessMentions("`harness --help`")).toEqual([
      { line: 1, words: [], flags: [] },
    ]);
  });

  it("ignores harness in prose outside code", () => {
    expect(harnessMentions("harness pr open --title x is prose.")).toEqual([]);
  });
});
