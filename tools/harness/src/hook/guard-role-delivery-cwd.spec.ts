import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAbsolute, relative, resolve } from "node:path";
import { commandOf, splitSegments } from "./guard-shell.js";
import { writes } from "./guard-role-writes.js";
import {
  mergesPr,
  runsJudgeTool,
  withSubstitutions,
} from "./guard-role-merge.js";
import { pushesByTracking, pushesToMain } from "./guard-role-push.js";
import { takesRoute, takesWriterRoute } from "./guard-role-routes.js";
import { checkDeliveryBash } from "./guard-role-delivery.js";
import { block } from "./guard-verdict.js";

vi.mock("node:path");
vi.mock("./guard-role-merge.js");
vi.mock("./guard-role-push.js");
vi.mock("./guard-role-routes.js");
vi.mock("./guard-role-allow.js");
vi.mock("./guard-role-writes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-writes.js")>()),
  writes: vi.fn(),
}));
vi.mock("./guard-shell.js");
vi.mock("./guard-verdict.js");

const ROOT = "/repo";
const DEEP = "/repo/tools/harness";

const splitWords = (command: string) =>
  command.split(" && ").map((s) => s.split(" "));

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

const bash = (command: string, cwd?: string) =>
  checkDeliveryBash("writer", false, command, ROOT, cwd);

beforeEach(() => {
  vi.mocked(splitSegments).mockImplementation(splitWords);
  vi.mocked(withSubstitutions).mockImplementation(splitWords);
  vi.mocked(commandOf).mockImplementation((tokens) => ({
    name: tokens[0] ?? "",
    args: tokens.slice(1),
  }));
  vi.mocked(resolve).mockImplementation(fold);
  vi.mocked(isAbsolute).mockImplementation((path) => path.startsWith("/"));
  vi.mocked(relative).mockImplementation(relativeTo);
  for (const check of [mergesPr, pushesToMain, takesRoute, takesWriterRoute]) {
    vi.mocked(check).mockReturnValue(false);
  }
  vi.mocked(pushesByTracking).mockReturnValue(false);
  vi.mocked(runsJudgeTool).mockReturnValue(false);
  vi.mocked(writes).mockReturnValue(false);
  vi.mocked(block).mockImplementation((rule, message) => ({
    action: "block",
    rule,
    message,
  }));
});

describe("checkDeliveryBash: relative paths resolve from the hook's directory", () => {
  it("lets a cd climb back to the worktree root from a subdirectory", () => {
    expect(bash("cd ../..", DEEP)).toBeNull();
  });

  it("still refuses a cd that climbs past the worktree root", () => {
    expect(bash("cd ../../..", DEEP)).toMatchObject({ rule: "role-worktree" });
  });

  it("follows an earlier cd in the same command", () => {
    expect(bash("cd tools/harness && cd ../..", ROOT)).toBeNull();
    expect(bash("cd tools/harness && cd ../../..", ROOT)).toMatchObject({
      rule: "role-worktree",
    });
  });

  it("reads git -C against the hook's directory and refuses one past the root", () => {
    expect(bash("git -C ../.. status", DEEP)).toBeNull();
    expect(bash("git -C ../../.. status", DEEP)).toMatchObject({
      rule: "role-worktree",
    });
  });

  it("resolves a written relative path from the hook's directory", () => {
    vi.mocked(writes).mockReturnValue(true);

    expect(bash("tee ../../docs/a.md", DEEP)).toBeNull();
    expect(bash("tee ../../../x", DEEP)).toMatchObject({
      rule: "role-worktree",
    });
  });

  it("refuses an absolute path outside the worktree from any directory", () => {
    vi.mocked(writes).mockReturnValue(true);

    expect(bash("cd /etc", DEEP)).toMatchObject({ rule: "role-worktree" });
    expect(bash("tee /etc/hosts", DEEP)).toMatchObject({
      rule: "role-worktree",
    });
  });

  it("resolves from the worktree root when no directory is given", () => {
    expect(bash("cd ..")).toMatchObject({ rule: "role-worktree" });
    expect(bash("cd tools")).toBeNull();
  });
});
