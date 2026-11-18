// The idea each writer session's pull request carries (#1093, spec #1086, ADR 0126): read from the
// idea on the session's earliest pr.linked event; for a link with no idea recorded (from before the
// field), the idea the GitHub poll set from the pull request's closing references; otherwise none.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";

/** The value a pull request's link writes when the pull request serves no idea (ADR 0126). */
export const NO_IDEA = "none";

/** A writer session's linked pull request, and the idea it carries; undefined when it carries none. */
export interface WriterLink {
  number: number;
  idea: string | undefined;
}

/**
 * One form for an idea named two ways: a bare issue number (`1083`) is the issue's `#1083`, as
 * session stamps and the poll write it. A harness idea number with leading zeros (`0030`), a slug
 * and a `#n` form are kept as written.
 */
export function ideaKey(idea: string): string {
  return /^[1-9]\d*$/.test(idea) ? `#${idea}` : idea;
}

/** Each pull request's idea from the poll: the idea on its earliest pr.opened or pr.merged event that has one. */
function pollIdeas(events: LedgerEvent[]): Map<number, string> {
  const earliest = new Map<number, { at: number; idea: string }>();
  for (const e of events) {
    if (
      e.source !== "github" ||
      (e.kind !== "pr.opened" && e.kind !== "pr.merged") ||
      e.number === undefined ||
      e.idea === undefined
    ) {
      continue;
    }
    const at = time(e);
    const seen = earliest.get(e.number);
    if (seen === undefined || at < seen.at) {
      earliest.set(e.number, { at, idea: e.idea });
    }
  }
  return new Map([...earliest].map(([number, v]) => [number, v.idea]));
}

/**
 * Each writer session's earliest link, by session name. A link that names an idea carries it; a
 * link that names none carries none (the writer said the pull request serves no idea, so the poll
 * is not asked); a link with no idea recorded takes the poll's idea for its pull request.
 */
export function writerLinks(events: LedgerEvent[]): Map<string, WriterLink> {
  const polled = pollIdeas(events);
  const first = new Map<string, { at: number; link: WriterLink }>();
  for (const e of events) {
    if (
      e.kind !== "pr.linked" ||
      e.number === undefined ||
      e.agent === undefined
    ) {
      continue;
    }
    const at = time(e);
    const seen = first.get(e.agent);
    if (seen !== undefined && seen.at <= at) {
      continue;
    }
    const named = e.idea === undefined ? polled.get(e.number) : e.idea;
    first.set(e.agent, {
      at,
      link: {
        number: e.number,
        idea:
          named === undefined || named === NO_IDEA ? undefined : ideaKey(named),
      },
    });
  }
  return new Map([...first].map(([agent, v]) => [agent, v.link]));
}
