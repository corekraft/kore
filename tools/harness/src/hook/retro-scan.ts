// Deterministic retrospective scan: counts over session transcripts that the
// retro skill interprets. Reports rule names, tool names, and short error
// summaries; never user or assistant text.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { createHash } from "node:crypto";
import { classifyAudit } from "../guardrail/index.js";
import { BareTally } from "./retro-bare.js";
import { windowStart } from "./retro-marker.js";
import { MainSessionTally } from "./retro-main-tally.js";
import { RuleLocations } from "./retro-locations.js";
import {
  SessionAnalysis,
  type GuardCounts,
  type Outcome,
} from "./retro-session.js";
import { parseTranscript, timestamps } from "./retro-transcript.js";

export { parseTranscript, summarizeError } from "./retro-transcript.js";

export interface SessionText {
  id: string;
  text: string;
}

export interface ScanOptions {
  /** A retrospective marker; sessions active before the window opens are left out. */
  since?: string | undefined;
  knownSkills?: readonly string[];
  auditRules?: readonly string[];
  /** Add the location of each guard block per rule; off by default so the default report is unchanged. */
  evidence?: boolean;
  /** The role each session name was launched as, from the ledger. A name it does not hold is counted as an unknown role. */
  roles?: Readonly<Record<string, string>>;
}

interface Evidence {
  session: string;
  line: number;
}

type RuleStats = Record<Outcome, number> & {
  warnings: number;
  sessions: number;
};

export {
  MarkerError,
  PLANS_DIR,
  lastRetrospective,
  markerInstant,
  windowStart,
} from "./retro-marker.js";
export { recordScanFigures } from "./retro-main-record.js";

const emptyStats = (): RuleStats => ({
  warnings: 0,
  sessions: 0,
  heeded: 0,
  overridden: 0,
  repeated: 0,
  unresolved: 0,
});

/** Counts added up across the sessions in the window. */
class Tally {
  readonly guards: Record<string, GuardCounts> = {};
  readonly guardEvidence = new RuleLocations();
  readonly overriddenEvidence = new RuleLocations();
  readonly failureCounts = new Map<string, number>();
  readonly perSession: Record<string, string[]> = {};
  readonly loaded = new Set<string>();
  readonly subagents = new Map<string, number>();
  readonly phraseSessions = new Map<string, Evidence[]>();
  readonly ruleStats: Map<string, RuleStats>;
  /** Bare sends per role session, rolled up per role. */
  readonly bare: BareTally;
  /** The main session's own figures, summed over the main sessions only (#940). */
  readonly main = new MainSessionTally();

  constructor(
    audit: readonly string[],
    private readonly knownSkills: readonly string[],
    roles: Readonly<Record<string, string>>,
  ) {
    this.ruleStats = new Map(audit.map((rule) => [rule, emptyStats()]));
    this.bare = new BareTally(roles);
  }

  add(id: string, found: SessionAnalysis): void {
    this.bare.add(id, found);
    this.main.add(found);
    this.addGuards(found);
    for (const { rule, line, excerpt } of found.guardBlocks) {
      this.guardEvidence.add(rule, { session: id, line, excerpt });
    }
    this.addWarnings(id, found);
    for (const { tool, error } of found.failures) {
      const key = `${tool}\u0000${error}`;
      this.failureCounts.set(key, (this.failureCounts.get(key) ?? 0) + 1);
    }
    this.addSkills(id, found);
    for (const name of found.subagents) {
      this.subagents.set(name, (this.subagents.get(name) ?? 0) + 1);
    }
    this.addPhrases(id, found);
  }

  private addGuards(found: SessionAnalysis): void {
    for (const [rule, counts] of Object.entries(found.guards)) {
      const total = (this.guards[rule] ??= { blocks: 0, warnings: 0 });
      total.blocks += counts.blocks;
      total.warnings += counts.warnings;
    }
  }

  private addSkills(id: string, found: SessionAnalysis): void {
    const used = new Set([
      ...found.skills,
      ...found.slashCommands.filter((name) => this.knownSkills.includes(name)),
    ]);
    for (const name of used) {
      this.loaded.add(name);
    }
    if (used.size > 0) {
      this.perSession[id] = [...used].sort();
    }
  }

  private addPhrases(id: string, found: SessionAnalysis): void {
    const seen = new Set<string>();
    for (const { phrase, line } of found.phrases) {
      if (seen.has(phrase)) {
        continue;
      }
      seen.add(phrase);
      const entry = this.phraseSessions.get(phrase) ?? [];
      entry.push({ session: id, line });
      this.phraseSessions.set(phrase, entry);
    }
  }

  private addWarnings(id: string, found: SessionAnalysis): void {
    const touched = new Set<RuleStats>();
    for (const warning of found.warnings) {
      const stats = this.ruleStats.get(warning.rule);
      if (stats) {
        stats.warnings++;
        const outcome = found.outcome(warning);
        stats[outcome]++;
        if (outcome === "overridden") {
          this.overriddenEvidence.add(warning.rule, {
            session: id,
            line: warning.line,
            excerpt: warning.excerpt,
            glob: warning.glob,
          });
        }
        touched.add(stats);
      }
    }
    for (const stats of touched) {
      stats.sessions++;
    }
  }

  failures(): { tool: string; error: string; count: number }[] {
    return [...this.failureCounts]
      .map(([key, count]) => {
        const [tool = "", error = ""] = key.split("\u0000");
        return { tool, error, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  /** Phrases from the same messages are one correction, so identical evidence merges. */
  corrections(): { id: string; sessions: number; evidence: Evidence[] }[] {
    const byEvidence = new Map<
      string,
      { phrases: string[]; evidence: Evidence[] }
    >();
    for (const [phrase, evidence] of this.phraseSessions) {
      if (evidence.length < 2) {
        continue;
      }
      const key = JSON.stringify(evidence);
      const group = byEvidence.get(key) ?? { phrases: [], evidence };
      group.phrases.push(phrase);
      byEvidence.set(key, group);
    }
    return [...byEvidence.values()]
      .map(({ phrases, evidence }) => ({
        id: createHash("sha1")
          .update(phrases.sort().join("\n"))
          .digest("hex")
          .slice(0, 8),
        sessions: evidence.length,
        evidence,
      }))
      .sort((a, b) => b.sessions - a.sessions);
  }

  rules() {
    const audit = [...this.ruleStats]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rule, stats]) => {
        const status = classifyAudit(stats.warnings, stats.heeded);
        return { rule, status, ...stats };
      });
    return {
      promotable: audit
        .filter((r) => r.status === "promotable")
        .map((r) => r.rule),
      audit,
    };
  }

  sortedGuards(): Record<string, GuardCounts> {
    return Object.fromEntries(
      Object.entries(this.guards).sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  sortedSubagents(): Record<string, number> {
    return Object.fromEntries(
      [...this.subagents].sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  unused(): string[] {
    return this.knownSkills.filter((name) => !this.loaded.has(name)).sort();
  }
}

/** Scan sessions into the report the retro skill reads. */
export function scan(
  inputs: readonly SessionText[],
  {
    since,
    knownSkills = [],
    auditRules: audit = [],
    evidence = false,
    roles = {},
  }: ScanOptions = {},
) {
  const included = inputs
    .map(({ id, text }) => parseTranscript(id, text))
    .map((session) => ({ session, ...timestamps(session) }))
    .filter(
      ({ last }) => last !== null && Date.parse(last) >= windowStart(since),
    )
    .sort((a, b) => (a.first ?? "").localeCompare(b.first ?? ""));
  const tally = new Tally(audit, knownSkills, roles);
  for (const { session } of included) {
    tally.add(session.id, new SessionAnalysis(session));
  }
  const firsts = included.flatMap((item) => item.first ?? []).sort();
  const lasts = included.flatMap((item) => item.last ?? []).sort();
  return {
    sessions: {
      count: included.length,
      first: firsts[0] ?? null,
      last: lasts.at(-1) ?? null,
      list: included.map(({ session, first, last }) => ({
        id: session.id,
        first,
        last,
      })),
    },
    skippedLines: included.reduce((sum, item) => sum + item.session.skipped, 0),
    guards: tally.sortedGuards(),
    ...(evidence
      ? {
          guardEvidence: tally.guardEvidence.sorted(),
          overriddenEvidence: tally.overriddenEvidence.sorted(),
        }
      : {}),
    failures: tally.failures(),
    skills: { perSession: tally.perSession, unused: tally.unused() },
    subagents: tally.sortedSubagents(),
    bareCommands: tally.bare.report(),
    mainSession: tally.main.report(),
    corrections: tally.corrections(),
    rules: tally.rules(),
  };
}
