import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const bundle = join(repo, "skills/bin/harness.mjs");
const esbuild = resolve(here, "../node_modules/.bin/esbuild");

let built = "";
let temp = "";
beforeAll(() => {
  temp = mkdtempSync(join(tmpdir(), "harness-root-"));
  // Test the source, not whatever bundle was last committed.
  built = join(temp, "src-bundle", "harness.mjs");
  execFileSync(
    esbuild,
    [
      "src/main.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node26",
      `--outfile=${built}`,
      "--log-level=error",
    ],
    { cwd: resolve(here, "..") },
  );
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function planActive(file: string, cwd: string, env: Record<string, string>) {
  const { CLAUDE_PROJECT_DIR: _unused, ...rest } = process.env;
  return spawnSync(process.execPath, [file, "plan", "active", "--json"], {
    cwd,
    env: { ...rest, ...env },
    encoding: "utf8",
  });
}

function repoBundle(): string {
  // The bundle laid out as <root>/skills/bin/harness.mjs inside the real repo.
  const dir = join(temp, "layout");
  mkdirSync(join(dir, "skills/bin"), { recursive: true });
  mkdirSync(join(dir, "infra/plans"), { recursive: true });
  writeFileSync(
    join(dir, "infra/plans/1-a.md"),
    "---\nstatus: active\n---\n## Step 1: A\n\n- [ ] x\n",
  );
  mkdirSync(join(dir, "deep/sub"), { recursive: true });
  copyFileSync(built, join(dir, "skills/bin/harness.mjs"));
  return dir;
}

describe("plan active repo root", () => {
  it("finds the plans from a subdirectory, resolving the root from the bundle location", () => {
    const dir = repoBundle();
    const result = planActive(
      join(dir, "skills/bin/harness.mjs"),
      join(dir, "deep/sub"),
      {},
    );
    expect(result.status).toBe(0);
    expect((JSON.parse(result.stdout) as { default: string }).default).toBe(
      "1-a.md",
    );
  });

  it("finds the plans from a subdirectory of the real repo with CLAUDE_PROJECT_DIR", () => {
    const result = planActive(built, join(repo, "tools/harness"), {
      CLAUDE_PROJECT_DIR: repo,
    });
    expect(result.status).toBe(0);
    expect(
      (JSON.parse(result.stdout) as { plans: unknown[] }).plans.length,
    ).toBeGreaterThan(0);
  });

  it("fails with a named error when CLAUDE_PROJECT_DIR holds no plans", () => {
    const result = planActive(bundle, temp, {
      CLAUDE_PROJECT_DIR: join(temp, "missing"),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CLAUDE_PROJECT_DIR");
    expect(result.stdout).toBe("");
  });

  it("fails with a named error when the bundle is not inside a repo", () => {
    const stray = join(temp, "stray/skills/bin");
    mkdirSync(stray, { recursive: true });
    copyFileSync(built, join(stray, "harness.mjs"));
    const result = planActive(join(stray, "harness.mjs"), temp, {});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot find the repo root");
  });
});
