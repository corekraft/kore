import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const driver = resolve(here, "../merge-driver.sh");
const driverConfig = "tools/harness/merge-driver.sh %O %A %B %P %Y";

let repo = "";

// The shared config of the repository this test file lives in. Nothing here
// may change it: a leak once flipped core.bare and added a merge driver.
const realConfig = join(
  execFileSync("git", ["-C", here, "rev-parse", "--git-common-dir"], {
    encoding: "utf8",
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
  }).trim(),
  "config",
);
const realConfigBefore = readFileSync(resolve(here, realConfig), "utf8");

// A git hook exports GIT_DIR and GIT_INDEX_FILE; inherited, they would point
// these commands at the real repository instead of the fixture.
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env,
  }).trim();
}

function tryGit(...args: string[]) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env });
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
      env,
    },
  );
}

function commit(message: string): void {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

// After every test has run, the real config must be exactly as it was.
afterAll(() => {
  const after = readFileSync(resolve(here, realConfig), "utf8");
  expect(after).toBe(realConfigBefore);
  expect(/^\s*bare\s*=\s*true/m.test(after)).toBe(false);
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

  it("never changes the real repository config, core.bare included", () => {
    git("config", "merge.harness-bundle.driver", driverConfig);
    tryGit("merge", "--no-edit", "feature");
    expect(readFileSync(resolve(here, realConfig), "utf8")).toBe(
      realConfigBefore,
    );
  });
});
