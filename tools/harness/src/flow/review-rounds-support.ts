// Shared by the review-rounds specs (#1050): ledger events and the default readings of the modules
// the unit mocks. The spec mocks the modules; this file only sets their readings.

import { vi } from "vitest";
import type { Kind, LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";
import {
  headNamings,
  isReviewedAtHead,
  sendBackHeadOf,
  verdictsOf,
  type Verdict,
} from "./review-heads.js";
import { inWindow, type Span } from "./scope.js";
import { linkedAgents, pricedLaunches, tierOfLinked } from "./writer-join.js";
import { reworkSendsIn } from "./writer-tier-figures.js";

export const SPAN: Span = [0, 1000];
export const HAIKU = "claude-haiku-5-5";
export const SONNET = "claude-sonnet-5-5";
export const TIERS = [HAIKU, SONNET];
const WRITER_TIER: Record<string, string> = {
  "h-writer": HAIKU,
  "s-writer": SONNET,
};

let seq = 0;
export function event(
  kind: Kind,
  at: number,
  fields: Partial<LedgerEvent> = {},
): LedgerEvent {
  seq += 1;
  return {
    schema: 1,
    id: `e${seq}`,
    source: "claude",
    kind,
    occurredAt: new Date(at).toISOString(),
    recordedAt: new Date(at).toISOString(),
    ...fields,
  };
}

export const merged = (number: number, at = 500) =>
  event("pr.merged", at, { number });

export const sendBack = (number: number | undefined, label: string, at = 100) =>
  event("send-back", at, {
    ...(number === undefined ? {} : { number }),
    label,
  });

export const verdict = (
  number: number,
  head: string,
  findings: number | undefined,
  at = 100,
): Verdict => ({ number, head, at, findings });

/** Gives every mocked module the reading the unit starts from: no link, no verdict, no rework. */
export function resetReadings() {
  vi.resetAllMocks();
  vi.mocked(time).mockImplementation((e) => Date.parse(e.occurredAt));
  vi.mocked(inWindow).mockImplementation(
    (span, at) => at >= span[0] && at < span[1],
  );
  vi.mocked(sendBackHeadOf).mockImplementation(
    (e) => /@(\w+)$/.exec(e.label ?? "")?.[1],
  );
  vi.mocked(verdictsOf).mockReturnValue([]);
  vi.mocked(headNamings).mockReturnValue([]);
  vi.mocked(isReviewedAtHead).mockReturnValue(false);
  vi.mocked(pricedLaunches).mockReturnValue([]);
  vi.mocked(linkedAgents).mockReturnValue(new Map());
  vi.mocked(tierOfLinked).mockImplementation(
    (_launches, agent) => WRITER_TIER[agent],
  );
  vi.mocked(reworkSendsIn).mockReturnValue(new Map());
}

/** Pull requests linked to writer sessions; each session joins to the tier WRITER_TIER names for it. */
export function linkWriters(links: [number, string][]) {
  vi.mocked(linkedAgents).mockReturnValue(new Map(links));
}

/** The pull requests the mocked head reading finds a verdict for at their head. */
export function reviewed(numbers: number[]) {
  vi.mocked(isReviewedAtHead).mockImplementation((number) =>
    numbers.includes(number),
  );
}
