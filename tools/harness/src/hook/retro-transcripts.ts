// Finding the session transcripts that belong to this repository and its
// worktrees, then reading them for the retrospective scan.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { basename, join, sep } from "node:path";
import type { FileSystem, Runner } from "../runtime/index.js";
import type { SessionText } from "./retro-scan.js";

const PROBE_BYTES = 256 * 1024;
const DEFAULT_BRANCHES = new Set(["main", "master", "HEAD"]);

export interface RepoCheckouts {
  main: string;
  worktrees: readonly string[];
  branches: readonly string[];
}

/** Claude names a project directory after its cwd with every non-alphanumeric replaced by "-". */
const encodePath = (path: string): string => path.replace(/[^a-zA-Z0-9]/g, "-");

const insideOf = (path: string, base: string): boolean =>
  path === base || path.startsWith(base + sep);

/** Whether one line of a transcript's head places it in the repository. */
function lineBelongs(line: string, roots: string[], branches: Set<string>) {
  try {
    const event = JSON.parse(line) as { cwd?: unknown; gitBranch?: unknown };
    const cwdInside =
      typeof event.cwd === "string" &&
      roots.some((root) => insideOf(event.cwd as string, root));
    return cwdInside || branches.has(event.gitBranch as string);
  } catch {
    // A partial last line or a foreign line proves nothing.
    return false;
  }
}

/**
 * Transcript directories under projectsDir whose sessions belong to the
 * repository ({ main, worktrees, branches }). Claude files a session under its
 * cwd, and worktrees are removed after use, so a directory name alone is not
 * enough. A directory qualifies when any of its transcripts shows one of:
 *   1. its name encodes the main checkout or a live worktree (git worktree list);
 *   2. a recorded cwd inside the main checkout or a live worktree, which covers
 *      removed worktrees under .claude/worktrees/;
 *   3. a recorded gitBranch that is a branch of this repository, other than
 *      main/master (which every repository has, so it would claim foreign work);
 *   4. the main checkout's absolute path in the first 256 KB, which covers a
 *      removed worktree outside the repository on a since-deleted branch.
 * Rules 3 and 4 are heuristics and favor over-inclusion; the retro skill reads
 * only the transcripts the scan names.
 */
export async function repoTranscriptDirs(
  fs: FileSystem,
  projectsDir: string,
  { main, worktrees, branches }: RepoCheckouts,
): Promise<string[]> {
  const roots = [...new Set([main, ...worktrees])];
  const names = new Set(roots.map(encodePath));
  const branchSet = new Set(branches.filter((b) => !DEFAULT_BRANCHES.has(b)));
  const belongs = async (dir: string): Promise<boolean> => {
    let files: string[];
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      return false;
    }
    for (const file of files) {
      let head: string;
      try {
        head = await fs.readHead(join(dir, file), PROBE_BYTES);
      } catch {
        continue;
      }
      if (
        head.includes(main) ||
        head.split("\n").some((line) => lineBelongs(line, roots, branchSet))
      ) {
        return true;
      }
    }
    return false;
  };
  let entries: string[];
  try {
    entries = await fs.readdir(projectsDir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of entries) {
    const dir = join(projectsDir, name);
    if (
      (await fs.isDirectory(dir)) &&
      (names.has(basename(dir)) || (await belongs(dir)))
    ) {
      found.push(dir);
    }
  }
  return found.sort();
}

async function git(runner: Runner, cwd: string, args: string[]) {
  const result = await runner.run("git", args, { cwd });
  return result.code === 0 ? result.stdout : "";
}

/** The repository's transcript directories: the main checkout and every worktree, live or removed. */
export async function defaultDirs(
  fs: FileSystem,
  runner: Runner,
  root: string,
  home: string,
): Promise<string[]> {
  const listed = await git(runner, root, ["worktree", "list", "--porcelain"]);
  const worktrees = listed
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  const common = (
    await git(runner, root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])
  ).trim();
  const main = worktrees[0] ?? (common ? join(common, "..") : root);
  const refs = await git(runner, root, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  const branches = refs
    .split("\n")
    .filter(Boolean)
    .map((name) => name.replace(/^origin\//, ""));
  return await repoTranscriptDirs(fs, join(home, ".claude", "projects"), {
    main,
    worktrees: worktrees.length > 0 ? worktrees : [main],
    branches,
  });
}

/** Every transcript in the directories, by session id; a resumed session in two directories keeps the fuller copy. */
export async function readTranscripts(
  fs: FileSystem,
  dirs: readonly string[],
): Promise<SessionText[]> {
  const byId = new Map<string, SessionText>();
  for (const dir of dirs) {
    for (const name of (await fs.readdir(dir)).filter((n) =>
      n.endsWith(".jsonl"),
    )) {
      const id = basename(name, ".jsonl");
      const text = await fs.readFile(join(dir, name));
      if (text.length >= (byId.get(id)?.text.length ?? -1)) {
        byId.set(id, { id, text });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
