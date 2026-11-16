import { describe, expect, it } from "vitest";
import {
  commandLookup,
  gitReadMayRun,
  whichMayRun,
} from "./guard-role-reads.js";

/** A line as the shell splits it: git and which go to their own check, the rest to command -v. */
const mayRun = (line: readonly string[]): boolean => {
  const [name, ...args] = line;
  if (name === "git") {
    return gitReadMayRun(args);
  }
  return name === "which" ? whichMayRun(args) : commandLookup(line);
};

describe("the git, which and command -v reads, each by its exact argv shape (#847)", () => {
  it.each([
    ["git", "merge-base", "HEAD", "origin/main"],
    ["git", "merge-base", "--is-ancestor", "a1b2c3", "origin/main"],
    ["git", "merge-base", "--all", "a", "b"],
    ["git", "cat-file", "-p", "HEAD"],
    ["git", "cat-file", "-t", "HEAD~1"],
    ["git", "cat-file", "-s", "HEAD:README.md"],
    ["git", "cat-file", "-e", "a1b2c3"],
    ["git", "ls-tree", "HEAD"],
    ["git", "ls-tree", "-r", "--name-only", "origin/main", "docs"],
    ["git", "ls-tree", "-l", "HEAD", "--", "docs/index.md"],
    ["git", "ls-remote", "origin"],
    ["git", "ls-remote", "--heads", "origin", "main"],
    ["git", "ls-remote", "--tags", "--refs", "origin"],
    ["git", "ls-remote", "https://github.com/corekraft/kore.git", "HEAD"],
    ["which", "git"],
    ["which", "-a", "node", "gh"],
  ])("allows %s", (...line) => {
    expect(mayRun(line)).toBe(true);
  });
});

describe("the options and shapes that are not reads (#847)", () => {
  it.each([
    ["merge-base with no revision", ["git", "merge-base"]],
    ["merge-base with one revision", ["git", "merge-base", "HEAD"]],
    [
      "merge-base --upload-pack",
      ["git", "merge-base", "--upload-pack=x", "a", "b"],
    ],
    [
      "merge-base after -c",
      ["git", "-c", "alias.x=!sh", "merge-base", "a", "b"],
    ],
    [
      "merge-base after -C",
      ["git", "-C", "/elsewhere", "merge-base", "a", "b"],
    ],
    ["merge-base an option as revision", ["git", "merge-base", "-o", "a", "b"]],
    [
      "merge-base with an output option",
      ["git", "merge-base", "--output=f", "a", "b"],
    ],
    ["cat-file with no object", ["git", "cat-file", "-p"]],
    ["cat-file with no mode", ["git", "cat-file", "HEAD"]],
    [
      "cat-file --textconv, which runs a driver",
      ["git", "cat-file", "--textconv", "HEAD:a"],
    ],
    [
      "cat-file --filters, which runs a filter",
      ["git", "cat-file", "--filters", "HEAD:a"],
    ],
    ["cat-file --batch, which reads commands", ["git", "cat-file", "--batch"]],
    ["cat-file -p with two objects", ["git", "cat-file", "-p", "a", "b"]],
    ["cat-file --output", ["git", "cat-file", "--output=f", "-p", "HEAD"]],
    ["cat-file -c", ["git", "-c", "core.pager=sh", "cat-file", "-p", "HEAD"]],
  ])("refuses %s", (_name, line) => {
    expect(mayRun(line)).toBe(false);
  });
});

describe("the ls-tree, ls-remote and which shapes that are not reads (#847)", () => {
  it.each([
    ["ls-tree with no tree", ["git", "ls-tree"]],
    ["ls-tree --output", ["git", "ls-tree", "--output=f", "HEAD"]],
    ["ls-tree -o", ["git", "ls-tree", "-o", "f", "HEAD"]],
    ["ls-tree --upload-pack", ["git", "ls-tree", "--upload-pack=x", "HEAD"]],
    ["ls-tree -c", ["git", "ls-tree", "-c", "x=y", "HEAD"]],
    ["ls-tree --git-dir", ["git", "--git-dir=/e", "ls-tree", "HEAD"]],
    ["ls-remote with no remote", ["git", "ls-remote"]],
    [
      "ls-remote --upload-pack",
      ["git", "ls-remote", "--upload-pack=sh", "origin"],
    ],
    [
      "ls-remote --upload-pack as two words",
      ["git", "ls-remote", "--upload-pack", "sh", "origin"],
    ],
    ["ls-remote --exec", ["git", "ls-remote", "--exec=sh", "origin"]],
    ["ls-remote -c", ["git", "ls-remote", "-c", "x=y", "origin"]],
    ["ls-remote -o", ["git", "ls-remote", "-o", "x", "origin"]],
    ["ls-remote -o glued", ["git", "ls-remote", "-ofoo", "origin"]],
    ["ls-remote --output", ["git", "ls-remote", "--output=f", "origin"]],
    [
      "ls-remote through the ext transport, which runs a command",
      ["git", "ls-remote", "ext::sh -c id", "x"],
    ],
    [
      "ls-remote through a -c config",
      ["git", "-c", "protocol.ext.allow=always", "ls-remote", "origin"],
    ],
    ["which with a write redirect", ["which", "git", ">", "f"]],
    ["which with an unknown option", ["which", "-s", "git"]],
    ["which with no name", ["which"]],
  ])("refuses %s", (_name, line) => {
    expect(mayRun(line)).toBe(false);
  });

  it.each(["fetch", "pull", "clone", "update-ref", "hash-object", "mktree"])(
    "refuses git %s, which writes refs or objects and no ticket allows",
    (verb) => {
      expect(mayRun(["git", verb, "origin"])).toBe(false);
    },
  );
});

describe("commandLookup: command -v and nothing else", () => {
  it.each([
    [["command", "-v", "git"]],
    [["command", "-v", "node", "gh", "docker-compose", "g++"]],
  ])("accepts %j", (segment) => {
    expect(commandLookup(segment)).toBe(true);
  });

  it.each([
    [["command", "-v"]],
    [["command", "-V", "git"]],
    [["command", "-p", "git", "push"]],
    [["command", "git", "push"]],
    [["env", "command", "-v", "git"]],
    [["command", "-v", "-p", "git"]],
    [["command", "-v", "/usr/bin/git"]],
    [["command", "-v", "git;id"]],
    [["command", "-v", "$HOME"]],
    [["which", "git"]],
  ])("refuses %j", (segment) => {
    expect(commandLookup(segment)).toBe(false);
  });
});
