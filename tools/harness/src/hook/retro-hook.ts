// `harness hook retro-scan`: the deterministic retrospective scan the retro
// skill runs first. Prints a JSON report of counts; never user or assistant text.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { homedir } from "node:os";
import { join } from "node:path";
import {
  CommandError,
  type CliDeps,
  type FileSystem,
} from "../runtime/index.js";
import { readPlans } from "../plan/index.js";
import { hookCommand, type HookResult } from "./io.js";
import { auditRules, lastRetrospective, scan } from "./retro-scan.js";
import { defaultDirs, readTranscripts } from "./retro-transcripts.js";

/** Where the guard's `warn("<rule>", ...)` calls name the audit-mode rules; repoint it when the guard moves. */
const GUARD_SOURCE = ".claude/hooks/guard.mjs";
const USAGE =
  "Usage: harness hook retro-scan [--dir <transcripts>] [--since YYYY-MM-DD]\n--since keeps sessions active at or after local midnight of that date, like the session-start count.";

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** The folders under skills/ that hold a SKILL.md, or undefined when there is no skills directory. */
async function skillNames(
  fs: FileSystem,
  root: string,
): Promise<string[] | undefined> {
  const dir = join(root, "skills");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (
      (await fs.isDirectory(join(dir, entry))) &&
      (await fs.exists(join(dir, entry, "SKILL.md")))
    ) {
      names.push(entry);
    }
  }
  return names;
}

interface Args {
  dir: string | undefined;
  since: string | undefined;
}

async function transcripts(
  deps: CliDeps,
  root: string,
  dir: string | undefined,
): Promise<{ inputs: Awaited<ReturnType<typeof readTranscripts>> } | string> {
  let dirs: string[] = [];
  try {
    dirs = dir
      ? [dir]
      : await defaultDirs(
          deps.fs,
          deps.runner,
          root,
          deps.env["HOME"] ?? homedir(),
        );
    const inputs = await readTranscripts(deps.fs, dirs);
    if (!dir && inputs.length === 0) {
      return `No transcripts found for this repository or its worktrees. Pass --dir <transcripts>.\n${USAGE}\n`;
    }
    return { inputs };
  } catch {
    return `Cannot read transcripts in ${dirs.join(", ") || "any project directory"}. Pass --dir <transcripts>.\n${USAGE}\n`;
  }
}

/** The guard's source, which names the audit-mode rules; a missing file is an expected error with its fix. */
async function readGuardSource(fs: FileSystem, root: string): Promise<string> {
  const path = join(root, GUARD_SOURCE);
  try {
    return await fs.readFile(path);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
    throw new CommandError(
      `Cannot read the guard source at ${path}, which lists the audit-mode rules. Point GUARD_SOURCE in tools/harness/src/hook/retro-hook.ts at where the guard now lives.`,
    );
  }
}

async function report(
  deps: CliDeps,
  { dir, since }: Args,
): Promise<HookResult> {
  const root = await deps.root();
  const found = await transcripts(deps, root, dir);
  if (typeof found === "string") {
    return { code: 2, stderr: found };
  }
  let stderr = "";
  const effective =
    since ??
    (dir ? undefined : (lastRetrospective(await readPlans(deps)) ?? undefined));
  const skills = await skillNames(deps.fs, root);
  if (skills === undefined) {
    stderr += "No skills/ directory found; skills.unused will be empty.\n";
  }
  const guardSource = await readGuardSource(deps.fs, root);
  if (effective === undefined && !dir) {
    stderr +=
      "No `Last retrospective:` date found; scanning all sessions. Pass --since to narrow.\n";
  }
  const result = scan(found.inputs, {
    since: effective,
    knownSkills: skills ?? [],
    auditRules: auditRules(guardSource),
  });
  const body = { since: effective ?? null, ...result };
  return { stdout: `${JSON.stringify(body, null, 2)}\n`, stderr };
}

export const retroScan = hookCommand(
  "retro-scan",
  "count guard blocks, failures, skills and repeated corrections over session transcripts (retro skill input)",
  async ({ deps, options }) => {
    const since = options["since"];
    if (typeof since === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
      return { code: 2, stderr: `${USAGE}\n` };
    }
    const dir = options["dir"];
    return await report(deps, {
      dir: typeof dir === "string" ? dir : undefined,
      since: typeof since === "string" ? since : undefined,
    });
  },
  { flags: { dir: "string", since: "string" }, payload: false },
);
