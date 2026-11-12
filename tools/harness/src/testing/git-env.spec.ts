import { describe, expect, it } from "vitest";
import { cleanGitEnv } from "./git-env.js";

describe("cleanGitEnv", () => {
  it("drops every GIT_* variable so a test's git never aims at the real repository", () => {
    const env = cleanGitEnv({
      GIT_DIR: "/real/.git",
      GIT_WORK_TREE: "/real",
      GIT_INDEX_FILE: "/real/.git/index",
      GIT_COMMON_DIR: "/real/.git",
      GIT_PREFIX: "tools/",
      GIT_AUTHOR_NAME: "x",
      HOME: "/home/a",
      PATH: "/bin",
      UNSET: undefined,
    });
    expect(env).toEqual({ HOME: "/home/a", PATH: "/bin" });
  });

  it("reads the process environment by default", () => {
    process.env["GIT_DIR"] = "/real/.git";
    try {
      expect(cleanGitEnv()["GIT_DIR"]).toBeUndefined();
      expect(cleanGitEnv()["PATH"]).toBe(process.env["PATH"]);
    } finally {
      delete process.env["GIT_DIR"];
    }
  });
});
