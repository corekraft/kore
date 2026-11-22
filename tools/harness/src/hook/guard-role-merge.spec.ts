import { basename } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commandOf, splitSegments } from "./guard-shell.js";
import {
  expand,
  isDash,
  mergesPr,
  runsJudgeTool,
  substituted,
  withSubstitutions,
} from "./guard-role-merge.js";

vi.mock("node:path");
vi.mock("./guard-shell.js");

const HARNESS = /^(\.\/)?skills\/bin\/harness\.mjs$/;

/** Fake shell: a segment is its words, and a command line is its first word and the rest. */
const splitWords = (command: string) => [command.split(" ")];
const commandWords = (words: readonly string[]) => ({
  name: words[0] ?? "",
  args: words.slice(1),
});

beforeEach(() => {
  vi.mocked(basename).mockImplementation((path) => path.split("/").pop() ?? "");
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(commandOf).mockImplementation(commandWords);
});

describe("isDash: a dash word is a flag", () => {
  it("is true for a word that starts with a dash, and false for anything else", () => {
    expect(isDash("-u")).toBe(true);
    expect(isDash("--repo")).toBe(true);
    expect(isDash("pr")).toBe(false);
    expect(isDash(undefined)).toBe(false);
  });
});

describe("expand: the command lines a segment may run", () => {
  it("returns only the segment when no wrapper, shell or eval hides a command", () => {
    expect(expand(["gh", "pr", "view"])).toEqual([["gh", "pr", "view"]]);
  });

  it("unwraps env, its valued options and VAR=value assignments before the command", () => {
    expect(
      expand(["FOO=1", "env", "-u", "X", "gh", "pr", "merge"]),
    ).toContainEqual(["gh", "pr", "merge"]);
  });

  it("unwraps sudo and reads the command name from a path", () => {
    expect(
      expand(["sudo", "-u", "root", "/usr/bin/gh", "pr", "merge"]),
    ).toContainEqual(["/usr/bin/gh", "pr", "merge"]);
  });

  it("expands a shell's -c script into the command lines it runs", () => {
    expect(expand(["bash", "-c", "gh pr merge 1"])).toContainEqual([
      "gh",
      "pr",
      "merge",
      "1",
    ]);
  });

  it("expands the line eval runs, joining its arguments", () => {
    expect(expand(["eval", "gh", "pr", "merge"])).toContainEqual([
      "gh",
      "pr",
      "merge",
    ]);
  });

  it("expands the command xargs runs, after its own valued options", () => {
    expect(expand(["xargs", "-I", "{}", "gh", "pr", "merge"])).toContainEqual([
      "gh",
      "pr",
      "merge",
    ]);
  });

  it("stops expanding at five levels of nesting, so a deeper command is not reached", () => {
    const chain = (depth: number) => [
      ...Array.from({ length: depth }, () => "eval"),
      "gh",
      "pr",
      "merge",
    ];

    expect(expand(chain(2))).toContainEqual(["gh", "pr", "merge"]);
    expect(expand(chain(7))).not.toContainEqual(["gh", "pr", "merge"]);
  });
});

describe("substituted: the commands inside substitutions", () => {
  it("finds the text of a $( ) substitution", () => {
    expect(substituted("echo $(gh pr merge 1)")).toEqual(["gh pr merge 1"]);
  });

  it("finds the text of a backtick substitution", () => {
    expect(substituted("echo `gh pr merge 1`")).toEqual(["gh pr merge 1"]);
  });

  it("finds a process substitution, <( ) or >( )", () => {
    expect(substituted("diff <(gh pr merge 1) x")).toEqual(["gh pr merge 1"]);
    expect(substituted("tee >(gh pr merge 1)")).toEqual(["gh pr merge 1"]);
  });

  it("finds a substitution nested in another, outer first", () => {
    expect(substituted("a $(b $(c))")).toEqual(["b $(c)", "c"]);
  });

  it("finds nothing in a command with no substitution", () => {
    expect(substituted("gh pr merge 1")).toEqual([]);
  });
});

describe("withSubstitutions: a command with the commands it substitutes", () => {
  it("splits the command and every substituted command, so a hidden merge is seen", () => {
    const segments = withSubstitutions("echo $(gh pr merge 1)");

    expect(segments).toContainEqual(["gh", "pr", "merge", "1"]);
    const split = vi.mocked(splitSegments).mock.calls.map(([text]) => text);
    expect(split).toContain("gh pr merge 1");
  });
});

describe("mergesPr: a gh command that merges or approves a pull request", () => {
  it.each([
    ["gh pr merge", ["gh", "pr", "merge", "12"]],
    ["gh pr merge with a repo flag", ["gh", "-R", "o/r", "pr", "merge", "12"]],
    [
      "the REST merge endpoint",
      ["gh", "api", "-X", "PUT", "repos/o/r/pulls/12/merge"],
    ],
    ["gh pr review", ["gh", "pr", "review", "12", "--approve"]],
    [
      "gh pr review with a repo flag",
      ["gh", "--repo", "o/r", "pr", "review", "12", "--approve"],
    ],
    [
      "the REST reviews endpoint",
      ["gh", "api", "-X", "POST", "repos/o/r/pulls/12/reviews"],
    ],
    [
      "a GraphQL review mutation",
      [
        "gh",
        "api",
        "graphql",
        "-f",
        "query=mutation { addPullRequestReview(input: {}) }",
      ],
    ],
    ["the merge-upstream endpoint", ["gh", "api", "repos/o/r/merge-upstream"]],
    ["the merges endpoint", ["gh", "api", "repos/o/r/merges"]],
    [
      "a GraphQL merge mutation",
      [
        "gh",
        "api",
        "graphql",
        "-f",
        "query=mutation { mergePullRequest(input: {}) }",
      ],
    ],
    [
      "a GraphQL query read from a file",
      ["gh", "api", "graphql", "-F", "q=@query.graphql"],
    ],
    [
      "a GraphQL query read from --input",
      ["gh", "api", "graphql", "--input", "q.json"],
    ],
  ])("is true for %s", (_name, segment) => {
    expect(mergesPr(segment)).toBe(true);
  });

  it("is true when the merge sits behind a wrapper", () => {
    expect(mergesPr(["env", "gh", "pr", "merge", "12"])).toBe(true);
  });

  it.each([
    ["a pull request read", ["gh", "pr", "view", "12"]],
    ["a pull request list", ["gh", "api", "repos/o/r/pulls"]],
    ["a command that is not gh", ["git", "pr", "merge"]],
  ])("is false for %s", (_name, segment) => {
    expect(mergesPr(segment)).toBe(false);
  });
});

describe("runsJudgeTool: the judge's merge, approve or send-back", () => {
  const judge = (...args: string[]) => [
    "node",
    "skills/bin/harness.mjs",
    ...args,
  ];

  it.each([
    ["merge", ["judge", "merge", "12"]],
    ["send-back", ["judge", "send-back", "12"]],
    ["approve", ["judge", "approve", "12"]],
  ])("is true for the judge's %s", (_name, args) => {
    expect(runsJudgeTool(judge(...args), HARNESS)).toBe(true);
  });

  it("is false for another judge command, such as status", () => {
    expect(runsJudgeTool(judge("judge", "status", "12"), HARNESS)).toBe(false);
  });

  it.each([
    ["a root help request for judge merge", ["judge", "merge", "--help"]],
    ["a short help request with --json", ["judge", "approve", "-h", "--json"]],
  ])("is false for %s, which runs nothing (#1802)", (_name, args) => {
    expect(runsJudgeTool(judge(...args), HARNESS)).toBe(false);
  });

  it("is true for a judge command with an operand before its help flag, which is no help request", () => {
    expect(
      runsJudgeTool(judge("judge", "merge", "12", "--help"), HARNESS),
    ).toBe(true);
  });

  it("is false when the script is not the harness the caller names", () => {
    expect(
      runsJudgeTool(["node", "other.mjs", "judge", "merge"], HARNESS),
    ).toBe(false);
  });
});
