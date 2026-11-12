import type { Span } from "./intervals.js";

export type { Span };

/** What a report covers: a time range, either end open, and optionally named ideas. */
export interface Scope {
  /** ISO time, or null for no start. */
  since: string | null;
  /** ISO time, or null for no end. */
  until: string | null;
  /** Idea keys such as `#12`, in issue-number order; null for every idea. */
  ideas: string[] | null;
}

export interface ScopeOptions {
  since?: Date;
  until?: Date;
  ideas?: string[];
}

const byNumber = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true });

/** The scope a report states for its options; ideas are deduplicated and ordered. */
export function scopeOf({ since, until, ideas }: ScopeOptions): Scope {
  return {
    since: since?.toISOString() ?? null,
    until: until?.toISOString() ?? null,
    ideas: ideas === undefined ? null : [...new Set(ideas)].sort(byNumber),
  };
}

/** The range in milliseconds, infinite where an end is open. */
export const windowOf = ({ since, until }: ScopeOptions): Span => [
  since?.getTime() ?? -Infinity,
  until?.getTime() ?? Infinity,
];

/** Milliseconds of `[from, to]` inside `window`. */
export const clipMs = (window: Span, from: number, to: number): number =>
  Math.max(0, Math.min(to, window[1]) - Math.max(from, window[0]));

/** Like `ledger list`, the start is inclusive and the end exclusive. */
export const inWindow = (window: Span, at: number): boolean =>
  at >= window[0] && at < window[1];
