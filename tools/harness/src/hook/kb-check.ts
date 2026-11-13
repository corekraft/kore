// Knowledge health check as a hook: `harness hook kb-check [--strict]`.
// Warn mode prints findings and exits 0; --strict exits 1 when there are any,
// or when a skill is over its budget (ADR 0080). Staleness and the flag audit
// are warnings only, so they never change the exit code.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { FlagError, unprovenFlags, unprovenLine } from "../flag/index.js";
import { run } from "../kb/index.js";
import type { KbDeps } from "../kb/index.js";
import { skillAudit } from "../skill/index.js";
import { CommandError, type CliDeps } from "../runtime/index.js";
import type { HookResult } from "./io.js";

const ENOENT = "ENOENT";
const EISDIR = "EISDIR";

async function git(
  deps: CliDeps,
  root: string,
  args: string[],
): Promise<string> {
  const result = await deps.runner.run("git", args, { cwd: root });
  if (result.code !== 0) {
    throw new CommandError(
      `git ${args.join(" ")} failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

/** The first line of a failure, as the flag audit reports a run that could not start. */
const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

/** The flag audit as warning lines: none when every flag that is on has live proof. */
async function flagAudit(deps: CliDeps, root: string): Promise<string[]> {
  try {
    const unproven = await unprovenFlags(deps.fs, deps.clock, root);
    return unproven.map(unprovenLine);
  } catch (error) {
    if (error instanceof FlagError) {
      return error.message.trim().split("\n");
    }
    return [
      `flag audit could not run (${reasonOf(error)}); run \`node skills/bin/harness.mjs flag audit\` to see the cause`,
    ];
  }
}

/**
 * The repository problems kb-check reports beyond documents: `core.bare = true`
 * in the shared git config, which a fixture's `git init` under an inherited
 * GIT_DIR writes and which breaks `git pull` in the main checkout (#368).
 * An unset key or a failed read is clean; only an explicit true is a problem.
 */
async function repositoryProblems(
  deps: CliDeps,
  root: string,
): Promise<string[]> {
  const bare = await deps.runner.run("git", ["config", "--get", "core.bare"], {
    cwd: root,
  });
  return bare.code === 0 && bare.stdout.trim() === "true"
    ? [
        "git config: core.bare is true in the shared .git/config, so git pull and git status fail in the main checkout; run `git config core.bare false`, then find the git init that ran with GIT_DIR set (tools/harness/src/testing/git-env.ts: cleanGitEnv)",
      ]
    : [];
}

/** Tracked and untracked-but-not-ignored regular files under root, with their text. */
async function readTree(
  deps: CliDeps,
  root: string,
): Promise<Map<string, string>> {
  const listed = await git(deps, root, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const tree = new Map<string, string>();
  for (const path of listed.split("\0").filter(Boolean)) {
    try {
      tree.set(path, await deps.fs.readFile(`${root}/${path}`));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== ENOENT && code !== EISDIR) {
        throw error;
      }
    }
  }
  return tree;
}

/** Runs the knowledge health check against the repository. */
export async function kbCheck(
  strict: boolean,
  deps: CliDeps,
): Promise<HookResult> {
  const root = await deps.root();
  const tree = await readTree(deps, root);
  const lines: string[] = [];
  const kbDeps: KbDeps = {
    files: () => [...tree.keys()],
    read: (path) => tree.get(path) ?? null,
    commitDate: async (path) =>
      (
        await git(deps, root, ["log", "-1", "--format=%cs", "--", path])
      ).trim() || null,
    audit: () => skillAudit(deps.fs, root),
    flagAudit: () => flagAudit(deps, root),
    repositoryProblems: () => repositoryProblems(deps, root),
  };
  const code = await run(strict ? ["--strict"] : [], kbDeps, (line) =>
    lines.push(line),
  );
  return { code, stdout: lines.map((line) => `${line}\n`).join("") };
}
