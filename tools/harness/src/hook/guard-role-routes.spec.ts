import { beforeEach, describe, expect, it, vi } from "vitest";
import { expand, isDash } from "./guard-role-merge.js";
import { gitCall } from "./guard-role-push.js";
import { commandOf } from "./guard-shell.js";
import { takesRoute, takesWriterRoute } from "./guard-role-routes.js";

vi.mock("./guard-role-merge.js");
vi.mock("./guard-role-push.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guard-role-push.js")>()),
  gitCall: vi.fn(),
}));
vi.mock("./guard-shell.js");

/** A gh command line, as the shell splits it; expand is faked to return the segment unchanged. */
const gh = (...words: string[]) => ["gh", ...words];

/** Command lines in a fake shell: the first word names the command, the rest are its arguments. */
const splitWords = (words: readonly string[]) => ({
  name: words[0] ?? "",
  args: words.slice(1),
});

beforeEach(() => {
  vi.mocked(expand).mockImplementation((segment) => [[...segment]]);
  vi.mocked(isDash).mockImplementation(
    (word) => word !== undefined && word.startsWith("-"),
  );
  vi.mocked(commandOf).mockImplementation(splitWords);
  vi.mocked(gitCall).mockReturnValue(undefined);
});

describe("takesRoute: a gh form that moves a branch or rewrites the ruleset", () => {
  it.each([
    ["alias set", ["alias", "set", "m", "pr merge"]],
    ["alias import", ["alias", "import", "aliases.yml"]],
  ])("takes the route for gh %s", (_name, args) => {
    expect(takesRoute(gh(...args))).toBe(true);
  });

  it.each([
    ["a REST write to a git ref", ["api", "-X", "POST", "repos/o/r/git/refs"]],
    [
      "a PATCH to a branch",
      ["api", "-X", "PATCH", "repos/o/r/git/refs/heads/main"],
    ],
    [
      "a DELETE of a ruleset",
      ["api", "--method", "DELETE", "repos/o/r/rulesets/12"],
    ],
    ["a contents write", ["api", "-X", "PUT", "repos/o/r/contents/a.md"]],
    [
      "a field, which makes the call a POST",
      ["api", "repos/o/r/git/trees", "-f", "x=1"],
    ],
  ])("takes the route for %s", (_name, args) => {
    expect(takesRoute(gh(...args))).toBe(true);
  });

  it("does not take the route for a read of the same path", () => {
    expect(takesRoute(gh("api", "repos/o/r/git/refs"))).toBe(false);
    expect(takesRoute(gh("api", "-X", "GET", "repos/o/r/rulesets/12"))).toBe(
      false,
    );
  });

  it("does not take the route for a write to a path the ruleset does not guard", () => {
    expect(takesRoute(gh("api", "-X", "POST", "repos/o/r/issues"))).toBe(false);
  });

  it("does not take the route for a command that is not gh", () => {
    vi.mocked(commandOf).mockReturnValue({
      name: "git",
      args: ["alias", "set"],
    });

    expect(takesRoute(["git", "alias", "set"])).toBe(false);
  });

  it("takes the route when a wrapped line inside the segment is the gh form", () => {
    vi.mocked(expand).mockReturnValue([
      ["env"],
      ["gh", "alias", "set", "m", "pr merge"],
    ]);

    expect(takesRoute(["env", "gh", "alias", "set", "m", "pr merge"])).toBe(
      true,
    );
  });
});

describe("takesWriterRoute: a route only the writer's full shell reaches", () => {
  it("takes the route for a git config write to a remote, push or branch key", () => {
    vi.mocked(gitCall).mockReturnValue({
      config: [],
      sub: "config",
      args: ["remote.origin.push", "HEAD:main"],
    });

    expect(
      takesWriterRoute(["git", "config", "remote.origin.push", "HEAD:main"]),
    ).toBe(true);
  });

  it("does not take the route for a git config read, or a key outside the push keys", () => {
    vi.mocked(gitCall).mockReturnValueOnce({
      config: [],
      sub: "config",
      args: ["--get", "remote.origin.push"],
    });
    vi.mocked(gitCall).mockReturnValueOnce({
      config: [],
      sub: "config",
      args: ["user.name", "x"],
    });

    expect(
      takesWriterRoute(["git", "config", "--get", "remote.origin.push"]),
    ).toBe(false);
    expect(takesWriterRoute(["git", "config", "user.name", "x"])).toBe(false);
  });

  it("takes the route for a config write flag even with no value after the key", () => {
    vi.mocked(gitCall).mockReturnValue({
      config: [],
      sub: "config",
      args: ["--unset", "branch.main.remote"],
    });

    expect(
      takesWriterRoute(["git", "config", "--unset", "branch.main.remote"]),
    ).toBe(true);
  });

  it("does not take the route for a git command that is not config", () => {
    vi.mocked(gitCall).mockReturnValue({
      config: [],
      sub: "push",
      args: ["origin"],
    });

    expect(takesWriterRoute(["git", "push", "origin"])).toBe(false);
  });

  it.each([
    ["gh auth token", ["auth", "token"]],
    ["gh auth git-credential", ["auth", "git-credential"]],
    ["gh auth status --show-token", ["auth", "status", "--show-token"]],
    ["gh auth status -t", ["auth", "status", "-t"]],
  ])("takes the route for %s, which prints the credential", (_name, args) => {
    expect(takesWriterRoute(gh(...args))).toBe(true);
  });

  it("takes the route for a graphql query that holds a shell expansion", () => {
    expect(takesWriterRoute(gh("api", "graphql", "-f", "query=$(cat q)"))).toBe(
      true,
    );
  });

  it("does not take the route for gh auth status without the token flag, or a graphql query without an expansion", () => {
    expect(takesWriterRoute(gh("auth", "status"))).toBe(false);
    expect(takesWriterRoute(gh("api", "graphql", "-f", "query=ok"))).toBe(
      false,
    );
  });

  it("checks every expanded line of the segment, so a wrapped credential read is taken", () => {
    vi.mocked(expand).mockReturnValue([["env"], ["gh", "auth", "token"]]);

    expect(takesWriterRoute(["env", "gh", "auth", "token"])).toBe(true);
  });
});
