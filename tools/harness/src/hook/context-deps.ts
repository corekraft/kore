// The files the context hook reads: AGENTS.md, the plans, the operation
// journals, and the session transcripts that stand for sessions since the last
// retrospective.
// Docs: infra/plans/4-knowledge.md#step-4-upward-context

import { homedir } from "node:os";
import { join } from "node:path";
import { environments, readOverlay } from "../flag/index.js";
import { readPlans } from "../plan/index.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import type { ContextDeps, JournalEntry } from "./context.js";
import { windowStart } from "./retro-scan.js";

const JOURNAL_DIR = ".kore/state/journal";
/** The flag that gives the main session the result-summary line (ADR 0123), read from the local overlay. */
export const PANE_RESULT_SUMMARY_FLAG = "pane-result-summary";
/** The flag that gives the main session the send line (ADR 0123), read from the local overlay. */
export const SIGNED_MAIN_SENDS_FLAG = "signed-main-sends";
const FLAG_ENVIRONMENT = "local";

/** Whether the local overlay turns the flag on. No overlay means off; a malformed one throws a FlagError. */
async function localFlagOn(
  fs: FileSystem,
  root: string,
  flag: string,
): Promise<boolean> {
  if (!(await environments(fs, root)).includes(FLAG_ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(fs, root, FLAG_ENVIRONMENT);
  return overlay.features[flag] === true;
}

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

function parseEntries(text: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const line of text.split("\n")) {
    try {
      const entry: unknown = JSON.parse(line);
      if (entry && typeof entry === "object") {
        entries.push(entry as JournalEntry);
      }
    } catch {
      // A torn or foreign line is not worth failing the brief.
    }
  }
  return entries;
}

/** Parsed entries per environment from the journal files under root; malformed lines are skipped. */
export async function readJournals(
  fs: FileSystem,
  root: string,
): Promise<Record<string, JournalEntry[]>> {
  const dir = join(root, JOURNAL_DIR);
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  } catch (error) {
    if (isMissing(error)) {
      return {};
    }
    throw error;
  }
  const journals: Record<string, JournalEntry[]> = {};
  for (const name of names) {
    let text: string;
    try {
      text = await fs.readFile(join(dir, name));
    } catch {
      continue; // An unreadable entry must not lose the rest of the brief.
    }
    journals[name.slice(0, -".jsonl".length)] = parseEntries(text);
  }
  return journals;
}

/** Transcripts of this project modified at or after the marker, leaving out the current session's. */
async function sessionsSince(
  deps: CliDeps,
  root: string,
  date: string | null,
  current: string | undefined,
): Promise<number> {
  const config = deps.env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude");
  const dir = join(config, "projects", root.replace(/[^a-zA-Z0-9]/g, "-"));
  let names: string[];
  try {
    names = await deps.fs.readdir(dir);
  } catch (error) {
    if (isMissing(error)) {
      return 0;
    }
    throw error;
  }
  const after = windowStart(date ?? undefined);
  let count = 0;
  for (const name of names) {
    if (
      name.endsWith(".jsonl") &&
      name !== `${current}.jsonl` &&
      (await deps.fs.mtimeMs(join(dir, name))) >= after
    ) {
      count += 1;
    }
  }
  return count;
}

/** The hook's inputs read from the repository at root. */
export function realContextDeps(deps: CliDeps, root: string): ContextDeps {
  return {
    readJournals: () => readJournals(deps.fs, root),
    readAgents: () => deps.fs.readFile(join(root, "AGENTS.md")),
    readPlans: () => readPlans(deps),
    sessionsSince: (date, current) => sessionsSince(deps, root, date, current),
    paneResultSummaryOn: () =>
      localFlagOn(deps.fs, root, PANE_RESULT_SUMMARY_FLAG),
    signedMainSendsOn: () => localFlagOn(deps.fs, root, SIGNED_MAIN_SENDS_FLAG),
  };
}
