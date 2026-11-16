// The writer's worktree bound, as a unit: the path a call names is inside the worktree or is not.
// Its collaborators are fakes; the paths are judged with a POSIX-like fold, as the cwd spec does.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAbsolute, relative, resolve } from "node:path";
import { codeStrings, withoutHeredocBodies } from "./guard-text.js";
import { commandOf, splitSegments } from "./guard-shell.js";
import { writes } from "./guard-role-writes.js";
import { block } from "./guard-verdict.js";
import { leavingWorktree, outside, runsInline } from "./guard-role-worktree.js";

vi.mock("node:path");
vi.mock("./guard-text.js");
vi.mock("./guard-shell.js");
vi.mock("./guard-role-writes.js");
vi.mock("./guard-verdict.js");

const ROOT = "/repo";

/** Fake resolve: joins onto the base and folds `..` and `.`, as a POSIX resolve does. */
function fold(base: string, path: string): string {
  const parts = (path.startsWith("/") ? path : `${base}/${path}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      out.pop();
    } else if (part !== "" && part !== ".") {
      out.push(part);
    }
  }
  return `/${out.join("/")}`;
}

/** Fake relative: the rest of `to` past `from`, else `../outside`. */
function relativeTo(from: string, to: string): string {
  if (to === from) {
    return "";
  }
  return to.startsWith(`${from}/`) ? to.slice(from.length + 1) : "../outside";
}

const splitWords = (command: string) =>
  command.split(" && ").map((s) => s.split(" "));

beforeEach(() => {
  vi.mocked(resolve).mockImplementation(fold);
  vi.mocked(relative).mockImplementation(relativeTo);
  vi.mocked(isAbsolute).mockImplementation((p) => p.startsWith("/"));
  vi.mocked(withoutHeredocBodies).mockImplementation((command) => command);
  vi.mocked(codeStrings).mockImplementation(() => []);
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(commandOf).mockImplementation((segment) => ({
    name: segment[0] ?? "",
    args: segment.slice(1),
  }));
  vi.mocked(writes).mockImplementation((segment) =>
    ["cp", "mv", "rm", "touch", "tee"].includes(segment[0] ?? ""),
  );
  vi.mocked(block).mockImplementation((rule, message) => ({
    action: "block",
    rule,
    message,
  }));
});

describe("outside", () => {
  it("is false for a path inside the root, and for the root itself", () => {
    expect(outside(ROOT, "/repo/tools/a.ts")).toBe(false);
    expect(outside(ROOT, "/repo")).toBe(false);
  });

  it("is true for a path past the root, and for a home path", () => {
    expect(outside(ROOT, "/repo/../main/a.ts")).toBe(true);
    expect(outside(ROOT, "/elsewhere/a.ts")).toBe(true);
    expect(outside(ROOT, "~/.config")).toBe(true);
  });

  it("is false for scratch space in tmp, which every session may use", () => {
    expect(outside(ROOT, "/tmp/scratch.txt")).toBe(false);
  });
});

describe("runsInline", () => {
  it("is true for an interpreter given inline code, and false for one given a file", () => {
    expect(runsInline(["node", "-e", "x"])).toBe(true);
    expect(runsInline(["python3", "-c", "x"])).toBe(true);
    expect(runsInline(["node", "script.js"])).toBe(false);
  });
});

describe("leavingWorktree", () => {
  it("returns no finding for a write inside the worktree", () => {
    expect(leavingWorktree("cp a tools/b", ROOT, ROOT)).toBeNull();
  });

  it("blocks a write whose path leaves the worktree", () => {
    expect(leavingWorktree("cp a /elsewhere/b", ROOT, ROOT)).toMatchObject({
      rule: "role-worktree",
    });
  });

  it("reads the heredoc-free command: the body is taken out before the segments are split", () => {
    vi.mocked(withoutHeredocBodies).mockImplementation(() => "cat > a.md");
    expect(
      leavingWorktree("cat > a.md <<'EOF'\ncp a /elsewhere/b\nEOF", ROOT, ROOT),
    ).toBeNull();
    expect(splitSegments).toHaveBeenCalledWith("cat > a.md");
  });

  it("reads the string literals of inline code, and not the code's regex literals", () => {
    vi.mocked(codeStrings).mockImplementation((code) =>
      code.includes("readFileSync") ? ["/elsewhere/a"] : [],
    );
    expect(
      leavingWorktree(
        "node -e readFileSync('/elsewhere/a') /repo/x",
        ROOT,
        ROOT,
      ),
    ).toMatchObject({ rule: "role-worktree" });
    vi.mocked(codeStrings).mockImplementation(() => []);
    expect(leavingWorktree("node -e re=/elsewhere/i", ROOT, ROOT)).toBeNull();
  });

  it("keeps the whole code word of python3 -c, which has no regex literal to set aside", () => {
    expect(
      leavingWorktree("python3 -c open('/elsewhere/a')", ROOT, ROOT),
    ).toMatchObject({ rule: "role-worktree" });
    expect(codeStrings).not.toHaveBeenCalled();
  });

  it("keeps the whole code word of node -e when it holds a substitution the shell runs, since a regex literal could hide it", () => {
    for (const code of ["/$(/elsewhere/b)/", "/`/elsewhere/b`/"]) {
      expect(leavingWorktree(`node -e ${code}`, ROOT, ROOT)).toMatchObject({
        rule: "role-worktree",
      });
    }
    expect(codeStrings).not.toHaveBeenCalled();
  });

  it("names every allowed heredoc and node -e shape in the finding, so a writer knows what passes", () => {
    const finding = leavingWorktree("cp a /elsewhere/b", ROOT, ROOT);
    expect(finding).toMatchObject({
      message: expect.stringContaining(
        "a heredoc whose whole command is one cat or tee writing a file inside the worktree",
      ),
    });
    expect(finding).toMatchObject({
      message: expect.stringContaining("a node -e regex literal"),
    });
  });

  it("keeps every word of inline code as a candidate when no code word follows a flag", () => {
    expect(leavingWorktree("node /elsewhere/x -e", ROOT, ROOT)).toMatchObject({
      rule: "role-worktree",
    });
  });
});
