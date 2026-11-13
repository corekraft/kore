// Deterministic retrospective scan: counts over session transcripts that the
// retro skill interprets. Reports rule names, tool names, and short error
// summaries; never user or assistant text.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { createHash } from "node:crypto";
import {
  SessionAnalysis,
  type GuardCounts,
  type Outcome,
} from "./retro-session.js";
import { parseTranscript, timestamps } from "./retro-transcript.js";

export { parseTranscript, summarizeError } from "./retro-transcript.js";

const MIN_WARNINGS = 5;
// A marker is a UTC timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`), or a legacy
// date-only value read as local midnight.
const RETRO_MARKER =
  /^\W*Last retrospective: (\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?)/gm;

export interface SessionText {
  id: string;
  text: string;
}

export interface ScanOptions {
  /** A retrospective marker; sessions active before the window opens are left out. */
  since?: string | undefined;
  knownSkills?: readonly string[];
  auditRules?: readonly string[];
}

interface Evidence {
  session: string;
  line: number;
}

type RuleStats = Record<Outcome, number> & {
  warnings: number;
  sessions: number;
};

/** When a marker opens the window, in epoch ms. */
function markerInstant(marker: string): number {
  return marker.includes("T")
    ? Date.parse(marker)
    : new Date(`${marker}T00:00:00`).getTime();
}

/** The latest `Last retrospective:` marker across the plans, or null. */
export function lastRetrospective(
  plans: Readonly<Record<string, string>>,
): string | null {
  let latest: string | null = null;
  for (const markdown of Object.values(plans)) {
    for (const match of markdown.matchAll(RETRO_MARKER)) {
      const marker = match[1] ?? "";
      if (latest === null || markerInstant(marker) > markerInstant(latest)) {
        latest = marker;
      }
    }
  }
  return latest;
}

/**
 * Where the retrospective window opens, in epoch ms (0 without a marker). The
 * window is closed on the left: a session active at or after that instant is
 * in the next retrospective. A timestamp marker opens the window at that
 * instant, so two retrospectives on one day do not overlap. A date-only marker
 * opens at local midnight of its day, so the sessions of that day that the
 * earlier retrospective already reviewed are counted again; that is preferred
 * to losing the ones that ran later that day. Each transcript is one session,
 * so none is counted twice.
 */
export function windowStart(marker: string | undefined): number {
  return marker ? markerInstant(marker) : 0;
}

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
  readonly failureCounts = new Map<string, number>();
  readonly perSession: Record<string, string[]> = {};
  readonly loaded = new Set<string>();
  readonly phraseSessions = new Map<string, Evidence[]>();
  readonly ruleStats: Map<string, RuleStats>;

  constructor(
    audit: readonly string[],
    private readonly knownSkills: readonly string[],
  ) {
    this.ruleStats = new Map(audit.map((rule) => [rule, emptyStats()]));
  }

  add(id: string, found: SessionAnalysis): void {
    this.addGuards(found);
    for (const { tool, error } of found.failures) {
      const key = `${tool}\u0000${error}`;
      this.failureCounts.set(key, (this.failureCounts.get(key) ?? 0) + 1);
    }
    this.addSkills(id, found);
    this.addPhrases(id, found);
    this.addWarnings(found);
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

  private addWarnings(found: SessionAnalysis): void {
    const touched = new Set<RuleStats>();
    for (const warning of found.warnings) {
      const stats = this.ruleStats.get(warning.rule);
      if (stats) {
        stats.warnings++;
        stats[found.outcome(warning)]++;
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
        let status = "insufficient-evidence";
        if (stats.warnings >= MIN_WARNINGS) {
          status =
            stats.heeded === stats.warnings ? "promotable" : "not-promotable";
        }
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

  unused(): string[] {
    return this.knownSkills.filter((name) => !this.loaded.has(name)).sort();
  }
}

/** Scan sessions into the report the retro skill reads. */
export function scan(
  inputs: readonly SessionText[],
  { since, knownSkills = [], auditRules: audit = [] }: ScanOptions = {},
) {
  const included = inputs
    .map(({ id, text }) => parseTranscript(id, text))
    .map((session) => ({ session, ...timestamps(session) }))
    .filter(
      ({ last }) => last !== null && Date.parse(last) >= windowStart(since),
    )
    .sort((a, b) => (a.first ?? "").localeCompare(b.first ?? ""));
  const tally = new Tally(audit, knownSkills);
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
    failures: tally.failures(),
    skills: { perSession: tally.perSession, unused: tally.unused() },
    corrections: tally.corrections(),
    rules: tally.rules(),
  };
}
