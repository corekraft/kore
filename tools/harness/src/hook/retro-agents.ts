// What the retro scan reads besides transcripts: the agent definitions and the
// ledger's launches. Read-only.
// Docs: infra/plans/12-self-improving-loop.md (Step 2)

import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger } from "../ledger/index.js";
import { mainRoot, type CliDeps, type FileSystem } from "../runtime/index.js";
import { proposalsFor, unusedAgents } from "./retro-proposals.js";
import { windowStart } from "./retro-scan.js";

const DAY_MS = 86_400_000;

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** The folders under skills/ that hold a SKILL.md, or undefined when there is no skills directory. */
export async function skillNames(
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

export interface AgentUsage {
  /** The agents with a definition under .claude/agents. */
  known: string[];
  /** The roles a session.launch event named at or after the window opened. */
  launched: string[];
  /** Whole days from the ledger's first event to now; 0 without a ledger. */
  ledgerDays: number;
}

/** The agent definitions, the roles launched since `sinceMs`, and the ledger's age. */
export async function readAgentUsage(
  deps: CliDeps,
  root: string,
  sinceMs: number,
): Promise<AgentUsage> {
  let files: string[] = [];
  try {
    files = await deps.fs.readdir(join(root, ".claude", "agents"));
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  const known = files
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -".md".length))
    .sort();
  const main = await mainRoot(deps);
  if (main === undefined) {
    return { known, launched: [], ledgerDays: 0 };
  }
  const ledger = new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    join(main, DEFAULT_LEDGER),
  );
  const { events } = await ledger.list({});
  const first = events
    .map((event) => Date.parse(event.recordedAt))
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
  const launched = events
    .filter(
      (event) =>
        event.kind === "session.launch" &&
        Date.parse(event.recordedAt) >= sinceMs,
    )
    .flatMap((event) => event.role ?? []);
  return {
    known,
    launched: [...new Set(launched)].sort(),
    ledgerDays: Number.isFinite(first)
      ? Math.floor((deps.clock.now().getTime() - first) / DAY_MS)
      : 0,
  };
}

/** What the scan found, as the parts of the report this module owns. */
export interface Found {
  sessions: { count: number };
  skills: { unused: string[] };
  rules: { promotable: string[] };
  /** Agent calls per agent definition, from the transcripts. */
  subagents: Record<string, number>;
}

/** The report's agents and proposals sections for a scan's findings. */
export async function agentSection(
  deps: CliDeps,
  root: string,
  since: string | undefined,
  found: Found,
) {
  const usage = await readAgentUsage(deps, root, windowStart(since));
  const inProcess = Object.fromEntries(
    Object.entries(found.subagents)
      .filter(([name]) => usage.known.includes(name))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const unused = unusedAgents(usage.known, [
    ...usage.launched,
    ...Object.keys(inProcess),
  ]);
  const { history, proposals } = proposalsFor({
    sessions: found.sessions.count,
    days: usage.ledgerDays,
    skills: found.skills.unused,
    agents: unused,
    promotable: found.rules.promotable,
  });
  return {
    agents: { known: usage.known, launched: usage.launched, inProcess, unused },
    proposals: { history, items: proposals },
  };
}
