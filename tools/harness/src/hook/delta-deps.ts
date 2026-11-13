// The real dependencies of the delta hook: git through the injected runner and
// plain files through the injected filesystem.

import { join, resolve } from "node:path";
import { readPlans } from "../plan/index.js";
import { hostLocksDirectory, type CliDeps } from "../runtime/index.js";
import type { DeltaDeps, JournalEntry, Snapshot } from "./delta.js";

const JOURNAL_DIR = ".kore/state/journal";

type Git = (...args: string[]) => Promise<string>;

function gitReader(deps: CliDeps, root: string): Git {
  return async (...args) => {
    const result = await deps.runner.run("git", args, { cwd: root });
    if (result.code !== 0) {
      throw new Error(`git ${args.join(" ")} exited ${result.code}`);
    }
    return result.stdout.trim();
  };
}

async function readDir(deps: CliDeps, dir: string): Promise<string[]> {
  try {
    return await deps.fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function parseEntries(text: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const line of text.split("\n")) {
    try {
      const entry = JSON.parse(line) as unknown;
      if (entry !== null && typeof entry === "object") {
        entries.push(entry as JournalEntry);
      }
    } catch {
      // A torn or foreign line is not worth failing the delta.
    }
  }
  return entries;
}

async function readJournals(
  deps: CliDeps,
  root: string,
): Promise<Record<string, JournalEntry[]>> {
  const dir = join(root, JOURNAL_DIR);
  const journals: Record<string, JournalEntry[]> = {};
  for (const name of await readDir(deps, dir)) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    try {
      journals[name.slice(0, -".jsonl".length)] = parseEntries(
        await deps.fs.readFile(join(dir, name)),
      );
    } catch {
      // An unreadable journal must not lose the rest of the delta.
    }
  }
  return journals;
}

/** Per-session snapshots under `<git-dir>/kore-delta`. */
function snapshotStore(
  deps: CliDeps,
  git: Git,
  root: string,
): Pick<
  DeltaDeps,
  "readSnapshot" | "writeSnapshot" | "listSnapshots" | "removeSnapshot"
> {
  const dir = async () =>
    join(resolve(root, await git("rev-parse", "--git-dir")), "kore-delta");
  const file = async (id: string) => join(await dir(), `${id}.json`);
  return {
    async readSnapshot(id) {
      try {
        return JSON.parse(await deps.fs.readFile(await file(id))) as Snapshot;
      } catch {
        return null;
      }
    },
    async writeSnapshot(id, snapshot) {
      await deps.fs.writeFile(await file(id), JSON.stringify(snapshot));
    },
    async listSnapshots() {
      const base = await dir();
      const found: { id: string; mtimeMs: number }[] = [];
      for (const name of await readDir(deps, base)) {
        if (name.endsWith(".json")) {
          found.push({
            id: name.slice(0, -".json".length),
            mtimeMs: await deps.fs.mtimeMs(join(base, name)),
          });
        }
      }
      return found;
    },
    async removeSnapshot(id) {
      await deps.fs.remove(await file(id));
    },
  };
}

/** The delta dependencies backed by git and the files under root. */
export function realDeltaDeps(deps: CliDeps, root: string): DeltaDeps {
  const git = gitReader(deps, root);
  return {
    now: () => deps.clock.now().getTime(),
    head: () => git("rev-parse", "HEAD"),
    branch: () => git("rev-parse", "--abbrev-ref", "HEAD"),
    async main() {
      try {
        return await git("rev-parse", "--verify", "--quiet", "main");
      } catch {
        return null;
      }
    },
    async commitsBetween(from, to) {
      return (await git("log", "--format=%s", `${from}..${to}`))
        .split("\n")
        .filter(Boolean);
    },
    readPlans: () => readPlans(deps),
    listLocks: () => readDir(deps, hostLocksDirectory(deps.env)),
    readJournals: () => readJournals(deps, root),
    ...snapshotStore(deps, git, root),
  };
}
