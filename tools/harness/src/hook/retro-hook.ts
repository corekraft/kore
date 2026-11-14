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
import {
  GuardrailError,
  auditRuleNames,
  readInventory,
} from "../guardrail/index.js";
import { readPlans } from "../plan/index.js";
import { hookCommand, type HookResult } from "./io.js";
import {
  lastRetrospective,
  MarkerError,
  markerInstant,
  scan,
} from "./retro-scan.js";
import { defaultDirs, readTranscripts } from "./retro-transcripts.js";

const USAGE =
  "Usage: harness hook retro-scan [--dir <transcripts>] [--since YYYY-MM-DD|YYYY-MM-DDTHH:MM:SSZ]\n--since keeps sessions active at or after local midnight of that date, or at or after that UTC instant, like the session-start count.";

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

/** The audit-mode rules, from the guardrail inventory; a missing or invalid one is an expected error with its fix. */
async function auditRules(deps: CliDeps, root: string): Promise<string[]> {
  try {
    return auditRuleNames(
      await readInventory((p) => deps.fs.readFile(p), root),
    );
  } catch (error) {
    if (error instanceof GuardrailError) {
      throw new CommandError(error.message);
    }
    throw error;
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
  let effective = since;
  if (effective === undefined && !dir) {
    try {
      effective = lastRetrospective(await readPlans(deps)) ?? undefined;
    } catch (error) {
      // The plan's author fixes this one, so it fails the scan by name
      // instead of failing open with no report.
      if (error instanceof MarkerError) {
        return { code: 2, stderr: `${error.message}\n` };
      }
      throw error;
    }
  }
  const skills = await skillNames(deps.fs, root);
  if (skills === undefined) {
    stderr += "No skills/ directory found; skills.unused will be empty.\n";
  }
  const audit = await auditRules(deps, root);
  if (effective === undefined && !dir) {
    stderr +=
      "No `Last retrospective:` date found; scanning all sessions. Pass --since to narrow.\n";
  }
  const result = scan(found.inputs, {
    since: effective,
    knownSkills: skills ?? [],
    auditRules: audit,
  });
  const body = { since: effective ?? null, ...result };
  return { stdout: `${JSON.stringify(body, null, 2)}\n`, stderr };
}

export const retroScan = hookCommand(
  "retro-scan",
  "count guard blocks, failures, skills and repeated corrections over session transcripts (retro skill input)",
  async ({ deps, options }) => {
    const since = options["since"];
    if (typeof since === "string" && !Number.isFinite(markerInstant(since))) {
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
