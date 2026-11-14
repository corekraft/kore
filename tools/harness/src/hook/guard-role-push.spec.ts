import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expand, isDash } from "./guard-role-merge.js";
import { commandOf } from "./guard-shell.js";
import {
  branchesOf,
  gitCall,
  pushesByTracking,
  pushesToMain,
  PUSH_KEY,
} from "./guard-role-push.js";

vi.mock("node:child_process");
vi.mock("node:fs");
vi.mock("node:path");
vi.mock("./guard-role-merge.js");
vi.mock("./guard-shell.js");

const ROOT = "/repo";

/** Fake shell: the first word names the command, the rest are its arguments. */
const words = (line: readonly string[]) => ({
  name: line[0] ?? "",
  args: line.slice(1),
});

/**
 * git's answer for each subcommand line, keyed by the words after `-C <root>`. A null
 * answer is a git that fails, which the unit reads as no answer.
 */
function gitAnswers(answers: Record<string, string | null>) {
  vi.mocked(execFileSync).mockImplementation((_file, args) => {
    const key = (args ?? []).slice(2).join(" ");
    const answer = answers[key];
    if (answer === undefined || answer === null) {
      throw new Error(`git ${key} failed`);
    }
    return `${answer}\n`;
  });
}

beforeEach(() => {
  vi.mocked(basename).mockImplementation((path) => path.split("/").pop() ?? "");
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(commandOf).mockImplementation(words);
  vi.mocked(isDash).mockImplementation(
    (word) => word !== undefined && word.startsWith("-"),
  );
  vi.mocked(expand).mockImplementation((segment) => [[...segment]]);
  gitAnswers({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gitCall: the git command a line runs", () => {
  it("reads the subcommand and the words after it", () => {
    expect(gitCall(["git", "push", "origin", "main"])).toEqual({
      config: [],
      sub: "push",
      args: ["origin", "main"],
    });
  });

  it("collects the key of each -c configuration given before the subcommand", () => {
    expect(
      gitCall(["git", "-c", "remote.origin.push=HEAD:x", "push", "origin"]),
    ).toMatchObject({ config: ["remote.origin.push"], sub: "push" });
    expect(
      gitCall(["git", "--config-env=push.default=VAR", "push"]),
    ).toMatchObject({ config: ["push.default"], sub: "push" });
  });

  it("skips a valued option such as -C, so its path is not taken for the subcommand", () => {
    expect(gitCall(["git", "-C", "/repo", "status"])).toMatchObject({
      sub: "status",
    });
  });

  it("is undefined for a command that is not git", () => {
    expect(gitCall(["gh", "pr", "merge"])).toBeUndefined();
  });
});

describe("PUSH_KEY: the configuration keys that choose a push's target", () => {
  it.each(["remote.origin.push", "push.default", "branch.main.remote"])(
    "matches %s",
    (key) => {
      expect(PUSH_KEY.test(key)).toBe(true);
    },
  );

  it("does not match a key outside the push keys", () => {
    expect(PUSH_KEY.test("user.name")).toBe(false);
  });
});

describe("branchesOf: the checked-out branch and the one it tracks", () => {
  it("reads the current branch and the branch it tracks", () => {
    gitAnswers({
      "symbolic-ref --short -q HEAD": "feature",
      "config --get branch.feature.merge": "refs/heads/main",
    });

    expect(branchesOf(ROOT)).toEqual({ current: "feature", tracked: "main" });
    expect(vi.mocked(execFileSync).mock.calls).toContainEqual([
      "git",
      ["-C", ROOT, "symbolic-ref", "--short", "-q", "HEAD"],
      expect.objectContaining({ timeout: 15000 }),
    ]);
  });

  it("reads nothing when HEAD is detached, so neither branch is known", () => {
    expect(branchesOf(ROOT)).toEqual({
      current: undefined,
      tracked: undefined,
    });
    expect(vi.mocked(execFileSync)).toHaveBeenCalledTimes(1);
  });

  it("leaves tracked unset when the branch tracks nothing", () => {
    gitAnswers({ "symbolic-ref --short -q HEAD": "scratch" });

    expect(branchesOf(ROOT)).toEqual({
      current: "scratch",
      tracked: undefined,
    });
  });

  it("runs git without the GIT_ variables, so a GIT_DIR cannot point the read elsewhere", () => {
    vi.stubEnv("GIT_DIR", "/elsewhere");
    gitAnswers({ "symbolic-ref --short -q HEAD": "main" });

    branchesOf(ROOT);

    const options = vi.mocked(execFileSync).mock.calls[0]?.[2];
    expect(options).toMatchObject({
      env: expect.not.objectContaining({ GIT_DIR: "/elsewhere" }),
    });
  });
});

describe("pushesToMain: a push that names main as its target", () => {
  it.each([
    ["the branch main", ["git", "push", "origin", "main"]],
    ["HEAD to main", ["git", "push", "origin", "HEAD:main"]],
    ["a forced main", ["git", "push", "origin", "+main"]],
    ["every branch", ["git", "push", "origin", "refs/heads/*"]],
    ["--all", ["git", "push", "--all", "origin"]],
    ["--mirror", ["git", "push", "--mirror", "origin"]],
    ["a repo named with --repo", ["git", "push", "--repo", "origin", "main"]],
  ])("is true for a push to %s", (_name, segment) => {
    expect(pushesToMain(segment)).toBe(true);
  });

  it("is true for a push that a -c key redirects, since its target is not read here", () => {
    expect(
      pushesToMain([
        "git",
        "-c",
        "remote.origin.push=HEAD:main",
        "push",
        "origin",
        "feature",
      ]),
    ).toBe(true);
  });

  it("is true for a push run by xargs, since xargs supplies the refspec at run time", () => {
    vi.mocked(expand).mockReturnValue([["xargs"], ["git", "push", "origin"]]);

    expect(pushesToMain(["xargs", "git", "push", "origin"])).toBe(true);
  });

  it("is true when the push sits behind a wrapper the unit expands", () => {
    vi.mocked(expand).mockReturnValue([
      ["env"],
      ["git", "push", "origin", "main"],
    ]);

    expect(pushesToMain(["env", "git", "push", "origin", "main"])).toBe(true);
  });

  it.each([
    ["a push to a feature branch", ["git", "push", "origin", "feature"]],
    ["a git command that is not a push", ["git", "status"]],
    ["a command that is not git", ["gh", "pr", "merge"]],
  ])("is false for %s", (_name, segment) => {
    expect(pushesToMain(segment)).toBe(false);
  });
});

describe("pushesByTracking: a push that leaves its target to the branch", () => {
  it("is false when the checked-out branch is a feature branch that tracks nothing", () => {
    gitAnswers({ "symbolic-ref --short -q HEAD": "feature" });

    expect(pushesByTracking(["git", "push"], ROOT)).toBe(false);
  });

  it("is true when the checked-out branch is main", () => {
    gitAnswers({ "symbolic-ref --short -q HEAD": "main" });

    expect(pushesByTracking(["git", "push", "origin"], ROOT)).toBe(true);
  });

  it("is true when the checked-out branch tracks main", () => {
    gitAnswers({
      "symbolic-ref --short -q HEAD": "feature",
      "config --get branch.feature.merge": "refs/heads/main",
    });

    expect(pushesByTracking(["git", "push", "origin", "HEAD"], ROOT)).toBe(
      true,
    );
  });

  it("fails closed when HEAD is detached, because the branch cannot be read", () => {
    expect(pushesByTracking(["git", "push"], ROOT)).toBe(true);
  });

  it("is false when the root is not a directory, so there is no branch to track", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(pushesByTracking(["git", "push"], ROOT)).toBe(false);
  });

  it("is false when the push names a refspec other than HEAD, which pushesToMain judges instead", () => {
    gitAnswers({ "symbolic-ref --short -q HEAD": "main" });

    expect(pushesByTracking(["git", "push", "origin", "feature"], ROOT)).toBe(
      false,
    );
  });
});
