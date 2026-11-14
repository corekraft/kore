import { describe, expect, it, vi } from "vitest";
import {
  bareAssignment,
  setsEnvironment,
  writes,
} from "./guard-role-writes.js";

// commandOf and block are collaborators outside the unit: typed stubs stand in for them.
vi.mock("./guard-shell.js", () => ({
  commandOf: (tokens: readonly string[]) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }),
}));
vi.mock("./guard-verdict.js", () => ({
  block: (rule: string, message: string) => ({ rule, message }),
}));

describe("writes: a file change is a write, a read is not", () => {
  it("flags a redirect to a file, glued or spaced, whatever the command", () => {
    expect(writes(["cut", "-c1-2", "f", ">", "out"])).toBe(true);
    expect(writes(["cut", "-c1-2", "f", ">>out"])).toBe(true);
    expect(writes(["awk", "{print}", "f", ">", "out.txt"])).toBe(true);
  });

  it("flags sed -i in every spelling", () => {
    expect(writes(["sed", "-i", "s/a/b/", "f"])).toBe(true);
    expect(writes(["sed", "-ni", "1p", "f"])).toBe(true);
  });

  it("does not flag a redirect to /dev/null or the reads that were just allowed", () => {
    expect(writes(["sed", "-n", "1p", "f", "2>/dev/null"])).toBe(false);
    expect(writes(["sed", "-n", "1,40p", "f"])).toBe(false);
    expect(writes(["cut", "-c1-200", "f"])).toBe(false);
    expect(writes(["paste", "-", "-"])).toBe(false);
    expect(writes(["tr", "a-z", "A-Z"])).toBe(false);
    expect(writes(["wc", "-l", "f"])).toBe(false);
  });
});

describe("bareAssignment: a plain NAME=value and nothing else", () => {
  it("accepts a lone variable assignment", () => {
    expect(bareAssignment(["T=/a/b"])).toBe(true);
  });

  it("accepts an assignment whose redirect is a file write, which writes() still flags", () => {
    expect(bareAssignment(["T=x", ">", "a"])).toBe(true);
    expect(writes(["T=x", ">", "a"])).toBe(true);
  });

  it("refuses several assignments, an assignment before a command, and export", () => {
    expect(bareAssignment(["A=1", "B=2"])).toBe(false);
    expect(bareAssignment(["T=x", "cat", "f"])).toBe(false);
    expect(bareAssignment(["export", "X=1"])).toBe(false);
  });

  it("refuses names a program reads at run time, so a bare assignment cannot steer git or the shell", () => {
    expect(bareAssignment(["PAGER=less"])).toBe(false);
    expect(bareAssignment(["GIT_EXTERNAL_DIFF=x"])).toBe(false);
    expect(bareAssignment(["PATH=/tmp"])).toBe(false);
    expect(bareAssignment(["HOME=/tmp"])).toBe(false);
    expect(bareAssignment(["KORE_ROOT=/tmp"])).toBe(false);
  });
});

describe("setsEnvironment: a bare assignment passes, a prefix or export is refused", () => {
  it("passes a lone assignment, which is no environment change", () => {
    expect(setsEnvironment(["T=x"])).toBe(false);
  });

  it("refuses an assignment before a command, a steering name, export and the wrappers", () => {
    expect(setsEnvironment(["T=x", "cat", "f"])).toBe(true);
    expect(setsEnvironment(["PAGER=x"])).toBe(true);
    expect(setsEnvironment(["export", "X=1"])).toBe(true);
    expect(setsEnvironment(["env", "X=1", "cat"])).toBe(true);
    expect(setsEnvironment(["sudo", "x"])).toBe(true);
  });

  it("passes a plain command", () => {
    expect(setsEnvironment(["cat", "f"])).toBe(false);
  });
});
