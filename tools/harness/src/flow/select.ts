import type { LedgerEvent } from "../ledger/index.js";
import { stampLanded, withPaneAgents } from "./agents.js";
import { attribute } from "./attribution.js";
import { REPOSITORY_KINDS } from "./outcomes.js";
import { githubSpans, time, type GithubWait } from "./github-waits.js";
import type { Span } from "./intervals.js";
import { inWindow, type Scope } from "./scope.js";

/**
 * Groups events by idea. Events that name no agent first take the one their
 * pane was last given, and repository-wide signals (CI runs, reverts, owner
 * actions) belong to no idea, so they are left out here; `named` is every
 * event after naming, for the metrics that count them.
 */
export function groupByIdea(all: LedgerEvent[], window: Span) {
  const named = withPaneAgents(all);
  const events = named.filter((e) => !REPOSITORY_KINDS.has(e.kind));
  const ideaOf = attribute(events);
  const byIdea = new Map<string, LedgerEvent[]>();
  let unattributed = 0;
  const orphans: LedgerEvent[] = [];
  for (const event of events) {
    const idea = ideaOf.get(event.id);
    if (idea === undefined) {
      if (inWindow(window, time(event))) {
        unattributed += 1;
        orphans.push(event);
      }
    } else {
      byIdea.set(idea, [...(byIdea.get(idea) ?? []), event]);
    }
  }
  return { byIdea, unattributed, orphans, named, landed: stampLanded(all) };
}

/** The latest time an idea holds: its last event or the end of an open GitHub wait. */
export function reach(own: LedgerEvent[], waits: GithubWait[]): number {
  return Math.max(...own.map(time), ...waits.map(([, , stop]) => stop));
}

/** Keeps the named ideas, and those whose events or open waits reach into the window. */
export function select(
  byIdea: Map<string, LedgerEvent[]>,
  { ideas }: Scope,
  window: Span,
  asOf: number,
) {
  const kept = new Map<string, { own: LedgerEvent[]; waits: GithubWait[] }>();
  for (const [idea, own] of byIdea) {
    const waits = githubSpans(own, asOf);
    const first = Math.min(...own.map(time));
    if (
      (ideas === null || ideas.includes(idea)) &&
      first < window[1] &&
      reach(own, waits) >= window[0]
    ) {
      kept.set(idea, { own, waits });
    }
  }
  return kept;
}
