// Deterministic retrospective scan: counts over session transcripts that the
// retro skill interprets. Reports rule names, tool names, and short error
// summaries; never user or assistant text.
// Docs: infra/plans/5-self-maintenance.md#step-2-deterministic-retrospective-scan

import { createHash } from "node:crypto";
import { CommandError } from "../runtime/index.js";
import {
  SessionAnalysis,
  type GuardCounts,
  type Outcome,
} from "./retro-session.js";
import { parseTranscript, timestamps } from "./retro-transcript.js";

export { parseTranscript, summarizeError } from "./retro-transcript.js";

const MIN_WARNINGS = 5;
/** Guard-block locations kept per rule; the guard count still reports every block. */
const GUARD_EVIDENCE_CAP = 20;
// The whole value on the line is captured, so a near-miss form is refused
// rather than read as its date. Group 1 is the prefix, group 2 the value.
const RETRO_MARKER = /^(\W*Last retrospective: )(\S.*?)[ \t\r]*$/gm;
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

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
}

interface Evidence {
  session: string;
  line: number;
}

/** Where one guard block is: its session, transcript line and a short excerpt of the blocked result. */
interface GuardLocation extends Evidence {
  excerpt: string;
}

type RuleStats = Record<Outcome, number> & {
  warnings: number;
  sessions: number;
};

/** Where the plans live, relative to the repository root. */
export const PLANS_DIR = "infra/plans";

/**
 * A `Last retrospective:` value that is not a marker. It is an expected fault
 * the plan's author fixes, so callers catch it and say so, instead of letting
 * it end the hook as a harness fault.
 */
export class MarkerError extends CommandError {}

const notAMarker = (value: string): string =>
  `"${value}" is not a retrospective marker; write a date (YYYY-MM-DD) or a UTC timestamp with date -u +%Y-%m-%dT%H:%M:%SZ`;

/**
 * The instant a marker value opens the window at, in epoch ms, or NaN when the
 * value is not a marker. A bare date is local midnight of that day; a UTC
 * timestamp is that instant. Both must round-trip, so February 30 is refused
 * rather than rolled over to March 2.
 */
export function markerInstant(value: string): number {
  if (BARE_DATE.test(value)) {
    const midnight = new Date(`${value}T00:00:00`);
    return midnight.toLocaleDateString("sv") === value
      ? midnight.getTime()
      : Number.NaN;
  }
  if (UTC_TIMESTAMP.test(value)) {
    const instant = Date.parse(value);
    return Number.isFinite(instant) &&
      new Date(instant).toISOString() === value.replace(/Z$/, ".000Z")
      ? instant
      : Number.NaN;
  }
  return Number.NaN;
}

/** The latest `Last retrospective:` marker across the plans, or null. Throws, naming the plan line, for a value that is not a marker. */
export function lastRetrospective(
  plans: Readonly<Record<string, string>>,
): string | null {
  let latest: string | null = null;
  let latestAt = Number.NEGATIVE_INFINITY;
  for (const [plan, markdown] of Object.entries(plans)) {
    for (const match of markdown.matchAll(RETRO_MARKER)) {
      const prefix = match[1] ?? "";
      const value = match[2] ?? "";
      const instant = markerInstant(value);
      if (!Number.isFinite(instant)) {
        const line = markdown
          .slice(0, (match.index ?? 0) + prefix.length)
          .split("\n").length;
        throw new MarkerError(
          `${PLANS_DIR}/${plan}:${line}: ${notAMarker(value)}`,
        );
      }
      if (instant > latestAt) {
        latest = value;
        latestAt = instant;
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
  if (!marker) {
    return 0;
  }
  const instant = markerInstant(marker);
  if (!Number.isFinite(instant)) {
    throw new MarkerError(notAMarker(marker));
  }
  return instant;
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
  readonly guardEvidence: Record<string, GuardLocation[]> = {};
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
    this.addGuardLocations(id, found);
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

  private addGuardLocations(id: string, found: SessionAnalysis): void {
    for (const { rule, line, excerpt } of found.guardBlocks) {
      const locations = (this.guardEvidence[rule] ??= []);
      if (locations.length < GUARD_EVIDENCE_CAP) {
        locations.push({ session: id, line, excerpt });
      }
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

  sortedGuardEvidence(): Record<string, GuardLocation[]> {
    return Object.fromEntries(
      Object.entries(this.guardEvidence).sort(([a], [b]) => a.localeCompare(b)),
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
  }: ScanOptions = {},
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
    ...(evidence ? { guardEvidence: tally.sortedGuardEvidence() } : {}),
    failures: tally.failures(),
    skills: { perSession: tally.perSession, unused: tally.unused() },
    corrections: tally.corrections(),
    rules: tally.rules(),
  };
}
