// The kb-check report: findings, staleness, the flag audit and the skill audit.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check
// Plan: infra/plans/5-self-maintenance.md#step-5-stale-documents
// Plan: infra/plans/8-harness-measurement.md#step-2-skill-budget-audit

import { CommandError } from "../runtime/index.js";
import { findings } from "./findings.js";
import type { Finding } from "./markdown.js";
import { staleDocuments, type HistoryDeps } from "./stale.js";

export interface KbDeps extends HistoryDeps {
  /** The skill audit: its report text, and whether a skill is over budget or invalid. */
  audit?(): Promise<{ text: string; failing: boolean }>;
  /** The flag audit as warning lines: none when every flag that is on has live proof. */
  flagAudit?(): Promise<string[]>;
  /** Problems with the repository itself, as full lines; each counts as a finding. */
  repositoryProblems?(): Promise<string[]>;
}

/** One finding as `file:line: message; fix`. */
export function format(problem: Finding): string {
  return `${problem.file}:${problem.line}: ${problem.message}; ${problem.fix}`;
}

/** Print findings through log and return the exit code: 1 only for findings or a failing skill audit under --strict. */
export async function run(
  argv: readonly string[],
  deps: KbDeps,
  log: (line: string) => void,
): Promise<number> {
  const status = await runChecks(argv, deps, log);
  const audit = deps.audit?.bind(deps);
  if (!audit) {
    return status;
  }
  const failed = await printAudit(audit, log);
  if (failed) {
    // A skill over budget fails --strict (ADR 0080); an audit that could not run
    // fails it too, so no skill passes unchecked.
    const strict = argv.includes("--strict");
    log(
      strict
        ? "kb-check: skill audit failed"
        : "kb-check: skill audit failed (warn mode; --strict fails on it)",
    );
    return strict ? 1 : status;
  }
  return status;
}

/** Print the skill audit's report; true when it failed or could not run. */
async function printAudit(
  audit: () => Promise<{ text: string; failing: boolean }>,
  log: (line: string) => void,
): Promise<boolean> {
  let report: { text: string; failing: boolean };
  try {
    report = await audit();
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    log(
      `skill audit: not run (${error.message}); run \`node skills/bin/harness.mjs skill audit\` to see the cause`,
    );
    return true;
  }
  log("skill audit:");
  for (const line of report.text.trimEnd().split("\n")) {
    log(`  ${line}`.trimEnd());
  }
  return report.failing;
}

async function runChecks(
  argv: readonly string[],
  deps: KbDeps,
  log: (line: string) => void,
): Promise<number> {
  const strict = argv.includes("--strict");
  const problems = findings(deps);
  for (const problem of problems) {
    log(format(problem));
  }
  const repository = (await deps.repositoryProblems?.()) ?? [];
  for (const line of repository) {
    log(line);
  }
  const total = problems.length + repository.length;
  // Staleness is warn-only for now: it never changes the exit code, even --strict.
  const stale = await staleDocuments(deps);
  for (const item of stale) {
    log(
      `stale: ${item.document} was last verified ${item.verified}, but ${item.path} changed ${item.date}; re-read it and update last-verified`,
    );
  }
  // Flags on without proof (ADR 0077) are warn-only for now, like staleness (ADR 0080).
  const flags = (await deps.flagAudit?.()) ?? [];
  for (const line of flags) {
    log(`flag: ${line}`);
  }
  const staleNote = () => {
    if (stale.length > 0) {
      log(
        `kb-check: ${stale.length} stale ${stale.length === 1 ? "document" : "documents"} (warn only)`,
      );
    }
    if (flags.length > 0) {
      log(
        `kb-check: ${flags.length} flag audit ${flags.length === 1 ? "warning" : "warnings"} (warn only)`,
      );
    }
  };
  if (total === 0) {
    if (stale.length === 0 && flags.length === 0) {
      log("kb-check: clean");
    } else {
      staleNote();
    }
    return 0;
  }
  const noun = total === 1 ? "finding" : "findings";
  log(
    strict
      ? `kb-check: ${total} ${noun}`
      : `kb-check: ${total} ${noun} (warn mode; --strict fails on them)`,
  );
  staleNote();
  return strict ? 1 : 0;
}
