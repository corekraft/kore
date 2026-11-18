// The principles-review violations by cited rule label, per writer tier (#1051, spec #1024): for
// each priced tier, the pull request heads with a verdict in the span that found one or more
// violations (the latest such verdict standing), and the count of each short rule label those verdicts cite, with its share of the
// tier's citations. A pull request joins to the tier of its linked writer (writer-join.ts); a
// verdict on a pull request with no link is in the unlinked row and never given a tier by
// inference. The figures are counts and shares of short labels only: no verdict text is read.

import type { LedgerEvent } from "../ledger/index.js";
import { verdictsOf } from "./review-heads.js";
import { inWindow, type Span } from "./scope.js";
import { linkedAgents, pricedLaunches, tierOfLinked } from "./writer-join.js";

/** One rule label cited in a tier's failing verdicts: how many verdicts cite it, and its share of the tier's citations. */
export interface RuleCount {
  rule: string;
  count: number;
  /** The count over the tier's citations, to four places. */
  share: number;
}

/** One tier's row (or the unlinked row): its failing verdicts and the rule labels they cite. */
export interface TierViolations {
  /** Pull request heads with a verdict in the span that found one or more violations, each head once. */
  failedVerdicts: number;
  /** Of those, the verdicts that recorded no rule label. */
  unlabelled: number;
  /** The rule labels cited across those verdicts, a label counted once per verdict: the denominator of each share. */
  citations: number;
  /** Every cited label, most cited first and by label where counts tie. */
  rules: RuleCount[];
}

/** The flow report's violations by rule per writer tier; the JSON carries these exactly. */
export interface ViolationsByRule {
  tiers: Record<string, TierViolations>;
  unlinked: TierViolations;
}

/** The violations with nothing in the span: no tier row and an empty unlinked row. */
export const NO_VIOLATIONS: ViolationsByRule = {
  tiers: {},
  unlinked: { failedVerdicts: 0, unlabelled: 0, citations: 0, rules: [] },
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** A failing verdict's pull request and its distinct rule labels. */
interface Failing {
  number: number;
  labels: string[];
}

/** The failing verdicts recorded in the span, one per pull request head: the latest verdict's labels stand. */
function failingIn(events: LedgerEvent[], span: Span): Failing[] {
  const byHead = new Map<string, Failing>();
  for (const v of verdictsOf(events)) {
    if ((v.findings ?? 0) > 0 && inWindow(span, v.at)) {
      byHead.set(`${v.number}\0${v.head}`, {
        number: v.number,
        labels: [...new Set(v.rules)],
      });
    }
  }
  return [...byHead.values()];
}

/** The row for the given failing verdicts. */
function rowOf(failing: Failing[]): TierViolations {
  const counts = new Map<string, number>();
  for (const { labels } of failing) {
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const citations = [...counts.values()].reduce((sum, n) => sum + n, 0);
  return {
    failedVerdicts: failing.length,
    unlabelled: failing.filter((f) => f.labels.length === 0).length,
    citations,
    rules: [...counts]
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, "en"))
      .map(([rule, count]) => ({
        rule,
        count,
        share: round(count / citations),
      })),
  };
}

/**
 * The failing verdicts' cited rule labels per tier over the span, read from the given tiers in
 * their order. A verdict joins to the tier its pull request's writer joins to; one that joins to
 * none is in the unlinked row. Verdicts are placed by the time each was recorded.
 */
export function violationsByRuleIn(
  events: LedgerEvent[],
  span: Span,
  tiers: string[],
): ViolationsByRule {
  const launches = pricedLaunches(events);
  const agents = linkedAgents(events);
  const tierOf = (number: number): string | undefined => {
    const agent = agents.get(number);
    return agent === undefined ? undefined : tierOfLinked(launches, agent);
  };
  const failing = failingIn(events, span);
  return {
    tiers: Object.fromEntries(
      tiers.map((tier) => [
        tier,
        rowOf(failing.filter((f) => tierOf(f.number) === tier)),
      ]),
    ),
    unlinked: rowOf(failing.filter((f) => tierOf(f.number) === undefined)),
  };
}
