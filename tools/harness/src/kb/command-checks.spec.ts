// Harness commands and flags a current document names are checked against the command table.
import { beforeEach, expect, test, vi } from "vitest";
import { harnessMentions } from "../help/index.js";
import { checkedLines } from "./command-scope.js";
import {
  commandFindings,
  commandProblems,
  sourceProblems,
} from "./command-checks.js";
import { finding, type Finding } from "./markdown.js";
import { nearest } from "./nearest.js";
import { sourceTexts } from "./source-texts.js";
import { PROBLEM } from "./kb-support.js";
import type { CommandTable } from "../runtime/index.js";

vi.mock("../help/index.js", () => ({ harnessMentions: vi.fn() }));
vi.mock("./command-scope.js", () => ({ checkedLines: vi.fn() }));
vi.mock("./markdown.js", () => ({ finding: vi.fn() }));
vi.mock("./nearest.js", () => ({ nearest: vi.fn() }));
vi.mock("./source-texts.js", () => ({ sourceTexts: vi.fn() }));

const FILE = "docs/guides/x.md";
const COMMANDS: CommandTable = {
  pr: { open: { options: { title: "string" } }, check: {} },
  status: { "": { options: { json: "boolean" } } },
};

const messages = () =>
  vi.mocked(finding).mock.calls.map((call) => call.slice(1));

beforeEach(() => {
  vi.mocked(finding).mockReturnValue(PROBLEM as Finding);
  vi.mocked(checkedLines).mockReturnValue(() => true);
  vi.mocked(nearest).mockReturnValue(undefined);
  vi.mocked(harnessMentions).mockReturnValue([]);
  vi.mocked(sourceTexts).mockReturnValue([]);
});

test("a mention of a real command with a real flag is clean", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 3, words: ["pr", "open"], flags: ["title"] },
  ]);
  expect(commandProblems(FILE, "text", COMMANDS)).toEqual([]);
  expect(finding).not.toHaveBeenCalled();
});

test("a mention on a line the scope skips is not checked", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 3, words: ["pr", "opne"], flags: [] },
  ]);
  vi.mocked(checkedLines).mockReturnValue(() => false);
  expect(commandProblems(FILE, "text", COMMANDS)).toEqual([]);
});

test("an unknown command is reported with its line, the reference and the nearest real command", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 3, words: ["pr", "opne"], flags: [] },
  ]);
  vi.mocked(nearest).mockReturnValue("pr open");
  commandProblems(FILE, "text", COMMANDS);
  expect(nearest).toHaveBeenCalledWith("pr opne", [
    "pr open",
    "pr check",
    "status",
  ]);
  expect(messages()).toEqual([
    [
      3,
      "harness pr opne is not a harness command",
      "use harness pr open, the nearest real command",
    ],
  ]);
});

test("an unknown domain is reported as an unknown command", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 4, words: ["wat", "now"], flags: [] },
  ]);
  commandProblems(FILE, "text", COMMANDS);
  expect(messages()).toHaveLength(1);
  expect(messages()[0]?.[1]).toBe("harness wat now is not a harness command");
});

test("a domain named alone is a real mention and needs no command", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 5, words: ["pr"], flags: [] },
  ]);
  expect(commandProblems(FILE, "text", COMMANDS)).toEqual([]);
});

test("a flag the command does not declare is reported with the nearest flag it does declare", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 6, words: ["pr", "open"], flags: ["titel"] },
  ]);
  vi.mocked(nearest).mockReturnValue("title");
  commandProblems(FILE, "text", COMMANDS);
  expect(nearest).toHaveBeenCalledWith("titel", ["title", "json"]);
  expect(messages()).toEqual([
    [
      6,
      "harness pr open has no --titel flag",
      "use --title, a flag it declares",
    ],
  ]);
});

test("a global flag every command takes is never reported", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 7, words: ["status"], flags: ["json"] },
    { line: 8, words: ["pr", "check"], flags: ["json"] },
  ]);
  expect(commandProblems(FILE, "text", COMMANDS)).toEqual([]);
});

test("an unknown command's flags are not checked, because the command is already reported", () => {
  vi.mocked(harnessMentions).mockReturnValue([
    { line: 9, words: ["pr", "opne"], flags: ["whatever"] },
  ]);
  commandProblems(FILE, "text", COMMANDS);
  expect(messages()).toHaveLength(1);
});

test("the command check reads only the Markdown files the tree gives, and skips one it cannot read", () => {
  vi.mocked(harnessMentions).mockReturnValue([]);
  const texts: Record<string, string | null> = {
    "docs/a.md": "text",
    "docs/b.ts": "code",
    "docs/c.md": null,
  };
  commandFindings(
    { read: (path) => texts[path] ?? null, commands: () => COMMANDS },
    ["docs/a.md", "docs/b.ts", "docs/c.md"],
  );
  expect(harnessMentions).toHaveBeenCalledTimes(1);
  expect(harnessMentions).toHaveBeenCalledWith("text");
});

test("the command check reads nothing when the tree gives no command table", () => {
  vi.mocked(harnessMentions).mockReturnValue([]);
  const tree = { read: () => "text", commands: () => undefined };
  expect(commandFindings(tree, ["docs/a.md"])).toEqual([]);
  expect(harnessMentions).not.toHaveBeenCalled();
});

test("a harness command in a string literal is reported at the line the literal starts on, plus the mention's own line", () => {
  vi.mocked(sourceTexts).mockReturnValue([{ line: 10, text: "first\nsecond" }]);
  vi.mocked(harnessMentions).mockImplementation((text) =>
    text === "first\nsecond"
      ? [{ line: 2, words: ["pr", "opne"], flags: [] }]
      : [],
  );
  vi.mocked(nearest).mockReturnValue("pr open");
  sourceProblems("tools/harness/src/x.ts", "text", COMMANDS);
  expect(messages()).toEqual([
    [
      11,
      "harness pr opne is not a harness command",
      "use harness pr open, the nearest real command",
    ],
  ]);
});

test("a string literal that names no harness command reports nothing", () => {
  vi.mocked(sourceTexts).mockReturnValue([{ line: 3, text: "plain text" }]);
  expect(sourceProblems("tools/harness/src/x.ts", "text", COMMANDS)).toEqual(
    [],
  );
  expect(finding).not.toHaveBeenCalled();
});

test("the command check reads a harness source file's literals, but not its specs or a file outside the harness source", () => {
  vi.mocked(harnessMentions).mockReturnValue([]);
  vi.mocked(sourceTexts).mockReturnValue([]);
  const texts: Record<string, string> = {
    "tools/harness/src/a.ts": "code a",
    "tools/harness/src/a.spec.ts": "code spec",
    "tools/kore/src/b.ts": "code b",
    "docs/c.md": "text c",
  };
  const read = vi.fn((path: string) => texts[path] ?? null);
  commandFindings({ read, commands: () => COMMANDS }, Object.keys(texts));
  expect(read.mock.calls.map(([path]) => path)).toEqual([
    "tools/harness/src/a.ts",
    "docs/c.md",
  ]);
  expect(sourceTexts).toHaveBeenCalledWith("code a");
  expect(harnessMentions).toHaveBeenCalledWith("text c");
});
