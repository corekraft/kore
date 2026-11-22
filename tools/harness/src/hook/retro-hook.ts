// `harness hook retro-scan`: the deterministic retrospective scan the retro
// skill runs first. Prints a JSON report of counts; never user or assistant text.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { homedir } from "node:os";
import {
  CommandError,
  type CliDeps,
  type CommandHelp,
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
  recordScanFigures,
  scan,
} from "./retro-scan.js";
import { agentSection, sessionRoles, skillNames } from "./retro-agents.js";
import { defaultDirs, readTranscripts } from "./retro-transcripts.js";

const USAGE =
  "Usage: harness hook retro-scan [--dir <transcripts>] [--since YYYY-MM-DD|YYYY-MM-DDTHH:MM:SSZ] [--evidence]\n--since keeps sessions active at or after local midnight of that date, or at or after that UTC instant, like the session-start count.\n--evidence adds guardEvidence (the session, transcript line and excerpt of each guard block) and overriddenEvidence (the same, with the command excerpt and the unquoted glob the guard named, for each overridden audit warning), capped per rule. The default report leaves them out. The report also counts bareCommands: the bare gh comments and bare pane sends (send-text, send-keys) each role session made with Bash, per session and per role, the role read from the ledger's launch of its name. The main session, whose first message is no spawn brief, is left out. The report also has mainSession: the main session's foreground poll minutes, pane-result reads, and signed and raw sends. With the main-session-figures flag on in the local overlay, a scan of the repository's own transcripts (not --dir) records one retro.main-session ledger event. The report also lists the agents with no launch in the ledger or in-process Agent call (agents; pane launches under launched, in-process Agent calls counted per agent under inProcess) and a ready command for each finding (proposals): an idea for an unused skill or agent, needing 14 days of ledger or 100 sessions (retro in .claude/harness.json sets each), and a guardrail request for a promotable audit rule. The scan runs none of them.";

interface Args {
  dir: string | undefined;
  since: string | undefined;
  evidence: boolean;
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
  { dir, since, evidence }: Args,
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
    evidence,
    roles: await sessionRoles(deps),
  });
  // The repository's own transcripts only: a scan of another folder is not the flow's window.
  if (!dir) {
    await recordScanFigures(deps, root, effective, result.mainSession);
  }
  const body = {
    since: effective ?? null,
    ...result,
    ...(await agentSection(deps, root, effective, result)),
  };
  return { stdout: `${JSON.stringify(body, null, 2)}\n`, stderr };
}

const retroScanHelp: CommandHelp = {
  purpose:
    "Scans the session transcripts and prints a JSON report: guard blocks and warnings per rule, failed tools, skills loaded, repeated corrections, unused skills and agents, bare pane sends, and a ready command for each finding. It runs none of those commands; the retro skill reads the report and decides.",
  when: "The retro skill runs it first, with --strict, to count the sessions since the plan's Last retrospective date or since --since, before it proposes any change.",
  whenNot:
    "To count one repository's ledger events over a window, use harness flow report; to act on a finding, run the command the report names, such as harness guardrail request.",
  flags: {
    dir: "Reads the transcripts in this folder instead of the Claude project folders of the repository and its worktrees. A scan of another folder records no ledger event.",
    since:
      "The first day or instant to count: YYYY-MM-DD for local midnight, or YYYY-MM-DDTHH:MM:SSZ for that UTC instant. Any other value exits 2.",
    evidence:
      "Adds guardEvidence and overriddenEvidence: the session, line and excerpt of each guard block and each overridden audit warning, capped per rule.",
    strict: "A fault exits 1 instead of failing open with 0.",
  },
  examples: [
    {
      command: "harness hook retro-scan --since 2026-11-01",
      shows:
        "the JSON counts for the sessions active from 1 November, with a proposal for each finding",
    },
    {
      command: "harness hook retro-scan --since 2026-11-01 --evidence",
      shows:
        "the same report, with the session and line of each guard block and override",
    },
  ],
  exits: [
    {
      code: 0,
      meaning:
        "the JSON report is printed, with a note on stderr when, for example, the skills directory is missing; or a fault with no report, which exits 0 and names itself on stderr unless --strict",
    },
    {
      code: 1,
      meaning: "a fault under --strict, such as an invalid guardrail inventory",
    },
    {
      code: 2,
      meaning:
        "a usage problem: an invalid --since, no transcripts found, transcripts that cannot be read, or a Last retrospective date that cannot be read; stderr names the fix",
    },
  ],
  effects: {
    kind: "mutates",
    detail:
      "reads the transcripts and the ledger. A scan of the repository's own transcripts appends one retro.main-session ledger event to the main checkout's ledger, and only when the main-session-figures flag is on in the local overlay; a refused event fails the scan",
  },
  seeAlso: ["retro due", "retro record", "guardrail request"],
};

export const retroScan = hookCommand(
  "retro-scan",
  "count guard blocks, failures and repeated corrections in transcripts",
  async ({ deps, options }) => {
    const since = options["since"];
    if (typeof since === "string" && !Number.isFinite(markerInstant(since))) {
      return { code: 2, stderr: `${USAGE}\n` };
    }
    const dir = options["dir"];
    return await report(deps, {
      dir: typeof dir === "string" ? dir : undefined,
      since: typeof since === "string" ? since : undefined,
      evidence: options["evidence"] === true,
    });
  },
  {
    flags: { dir: "string", since: "string", evidence: "boolean" },
    payload: false,
    help: retroScanHelp,
  },
);
