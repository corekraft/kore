import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanGitEnv } from "../src/testing/git-env.js";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const driver = resolve(here, "../merge-driver.sh");
const driverConfig = "tools/harness/merge-driver.sh %O %A %B %P %Y";

let repo = "";

// The shared config of the repository this test file lives in. Nothing here
// may change core.bare or add the merge driver: leaks once did both. Only those
// keys are compared, since other worktrees change the rest of the file.
const realConfig = resolve(
  here,
  execFileSync("git", ["-C", here, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
    env: cleanGitEnv(),
  }).trim(),
  "config",
);

function guardedKeys(configFile: string): string {
  const value = (...args: string[]) =>
    spawnSync("git", ["config", "--file", configFile, ...args], {
      encoding: "utf8",
      env: cleanGitEnv(),
    }).stdout;
  return `${value("--get", "core.bare")}|${value("--get-regexp", "^merge\\.harness-bundle\\.")}`;
}

const realKeysBefore = guardedKeys(realConfig);

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: cleanGitEnv(),
  }).trim();
}

function tryGit(...args: string[]) {
  return spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: cleanGitEnv(),
  });
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function read(path: string): string {
  return readFileSync(join(repo, path), "utf8");
}

// A stand-in for `npm run build`: the "bundle" is the sources concatenated,
// plus a checksum footer, so two branches always edit the same bundle line.
function build(): void {
  execFileSync(
    "npm",
    ["--prefix", "tools/harness", "run", "build", "--silent"],
    {
      cwd: repo,
      env: cleanGitEnv(),
    },
  );
}

function commit(message: string): void {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

// After every test has run, the guarded keys of the real config are unchanged.
afterAll(() => {
  expect(guardedKeys(realConfig)).toBe(realKeysBefore);
});

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "merge-driver-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  write(
    "tools/harness/package.json",
    JSON.stringify({
      name: "fixture",
      private: true,
      scripts: {
        build:
          "cat src/a.txt src/b.txt > ../../skills/bin/harness.mjs && cat src/a.txt src/b.txt | cksum >> ../../skills/bin/harness.mjs",
      },
    }),
  );
  write("tools/harness/src/a.txt", "a1\na2\na3\n");
  write("tools/harness/src/b.txt", "b1\nb2\nb3\n");
  write(".gitattributes", "skills/bin/harness.mjs merge=harness-bundle\n");
  write(".gitignore", "node_modules\n");
  mkdirSync(join(repo, "tools/harness/node_modules"), { recursive: true });
  mkdirSync(join(repo, "skills/bin"), { recursive: true });
  copyFileSync(driver, join(repo, "tools/harness/merge-driver.sh"));
  build();
  commit("base");
  git("branch", "feature");
  // main edits b.txt and rebuilds; feature edits a.txt and rebuilds. Both
  // rewrite the bundle, so a plain merge conflicts in it.
  write("tools/harness/src/b.txt", "b1\nb2 from main\nb3\n");
  build();
  commit("main change");
  git("switch", "-q", "feature");
  write("tools/harness/src/a.txt", "a1\na2 from feature\na3\n");
  build();
  commit("feature change");
  git("switch", "-q", "main");
}, 60_000);

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const mergedSources = "a1\na2 from feature\na3\nb1\nb2 from main\nb3\n";
const merged = `${mergedSources}${execFileSync("cksum", { input: mergedSources, encoding: "utf8" })}`;

describe("harness bundle merge driver", () => {
  it("conflicts in the bundle without the driver, which is what it fixes", () => {
    const result = tryGit("merge", "--no-edit", "feature");
    expect(result.status).not.toBe(0);
    expect(read("skills/bin/harness.mjs")).toContain("<<<<<<<");
  });

  it("rebuilds the bundle from the merged sources on a merge", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    const result = tryGit("merge", "--no-edit", "feature");
    expect(result.status, result.stderr).toBe(0);
    expect(read("skills/bin/harness.mjs")).toBe(merged);
    expect(read("tools/harness/src/a.txt")).toContain("from feature");
    expect(git("status", "--porcelain")).toBe("");
  });

  it("rebuilds the bundle from the merged sources on a rebase", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    git("switch", "-q", "feature");
    const result = tryGit("rebase", "main");
    expect(result.status, result.stderr).toBe(0);
    expect(read("skills/bin/harness.mjs")).toBe(merged);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("leaves a conflict when the sources themselves conflict", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    git("switch", "-q", "feature");
    write("tools/harness/src/b.txt", "b1\nb2 from feature\nb3\n");
    build();
    commit("feature edits the same line as main");
    git("switch", "-q", "main");
    const result = tryGit("merge", "--no-edit", "feature");
    expect(result.status).not.toBe(0);
    expect(git("status", "--porcelain")).toContain("UU");
    expect(read("skills/bin/harness.mjs")).toContain("<<<<<<<");
  });

  it("names the cause and leaves a conflict when dependencies are not installed", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    rmSync(join(repo, "tools/harness/node_modules"), { recursive: true });
    const result = tryGit("merge", "--no-edit", "feature");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("npm ci --prefix tools/harness");
    expect(read("skills/bin/harness.mjs")).toContain("<<<<<<<");
  });
});

describe("harness bundle merge driver isolation", () => {
  it("keeps the real repository's core.bare and driver keys unchanged", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    tryGit("merge", "--no-edit", "feature");
    expect(guardedKeys(realConfig)).toBe(realKeysBefore);
  });

  it("cannot leak into the repository a hook points GIT_DIR at", () => {
    // A throwaway repo stands in for the real one a git hook would export.
    const victim = mkdtempSync(join(tmpdir(), "merge-driver-victim-"));
    const victimGit = (...args: string[]) =>
      execFileSync("git", ["-C", victim, ...args], {
        encoding: "utf8",
        env: cleanGitEnv(),
      }).trim();
    victimGit("init", "-q", "-b", "main");
    victimGit("config", "core.bare", "false");
    const before = guardedKeys(join(victim, ".git", "config"));
    const head = victimGit("rev-parse", "--git-dir");
    const saved = {
      dir: process.env.GIT_DIR,
      index: process.env.GIT_INDEX_FILE,
    };
    process.env.GIT_DIR = join(victim, head);
    process.env.GIT_INDEX_FILE = join(victim, ".git", "index");
    try {
      git("config", "merge.harness-bundle.driver", driverConfig);
      tryGit("merge", "--no-edit", "feature");
      write("tools/harness/src/a.txt", "changed in the fixture\n");
      build();
    } finally {
      for (const [key, value] of [
        ["GIT_DIR", saved.dir],
        ["GIT_INDEX_FILE", saved.index],
      ] as const) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
    const after = guardedKeys(join(victim, ".git", "config"));
    const commits = spawnSync(
      "git",
      ["-C", victim, "rev-parse", "-q", "--verify", "HEAD"],
      {
        encoding: "utf8",
        env: cleanGitEnv(),
      },
    );
    rmSync(victim, { recursive: true, force: true });
    expect(after).toBe(before);
    expect(commits.status).not.toBe(0);
  });
});

describe("harness bundle merge driver failures", () => {
  it("leaves markers and a non-zero result when the rebuild fails", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    git("switch", "-q", "feature");
    write(
      "tools/harness/package.json",
      JSON.stringify({
        name: "fixture",
        private: true,
        scripts: { build: "exit 1" },
      }),
    );
    commit("break the build");
    git("switch", "-q", "main");
    const result = tryGit("merge", "--no-edit", "feature");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("left skills/bin/harness.mjs conflicted");
    expect(read("skills/bin/harness.mjs")).toContain("<<<<<<<");
    expect(git("status", "--porcelain")).toContain("UU skills/bin/harness.mjs");
  });

  it("rebuilds the bundle from the merged sources on a cherry-pick", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    const result = tryGit("cherry-pick", "feature");
    expect(result.status, result.stderr).toBe(0);
    expect(read("skills/bin/harness.mjs")).toBe(merged);
    expect(git("status", "--porcelain")).toBe("");
  });

  it("fails with an install hint when mise is not installed", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    const tools = mkdtempSync(join(tmpdir(), "merge-driver-path-"));
    for (const name of [
      "bash",
      "sh",
      "env",
      "git",
      "tar",
      "mktemp",
      "rm",
      "cp",
      "mkdir",
      "grep",
      "cat",
      "dirname",
      "uname",
    ]) {
      const found = spawnSync("which", [name], {
        encoding: "utf8",
      }).stdout.trim();
      if (found) {
        symlinkSync(found, join(tools, name));
      }
    }
    const result = spawnSync(
      "git",
      ["-C", repo, "merge", "--no-edit", "feature"],
      {
        encoding: "utf8",
        env: { ...cleanGitEnv(), PATH: tools },
      },
    );
    rmSync(tools, { recursive: true, force: true });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mise is not installed");
    expect(read("skills/bin/harness.mjs")).toContain("<<<<<<<");
  });
});
