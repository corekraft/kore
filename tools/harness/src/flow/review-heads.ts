// The heads the ledger names for a pull request (#1050, spec #1024): the principles-review verdicts
// (review.run events labelled `posted:<head>` or `unchanged:<head>`) and the judge send-backs whose
// label ends in `@<head>`. The ledger records no merge head, so a merged change's head is the newest
// head one of these events names for it; a verdict counts only for the head it names.

import type { LedgerEvent } from "../ledger/index.js";
import { time } from "./github-waits.js";

/** A head is compared by its first seven characters, the length a send-back label carries. */
const HEAD_LENGTH = 7;

/** A review.run that posted or left unchanged a verdict: `posted:<head>` or `unchanged:<head>`. */
const VERDICT = /^(?:posted|unchanged):([0-9a-f]{7,40})$/;
/** The head a send-back's label ends with: `@<head>`. */
const SEND_BACK_HEAD = /@([0-9a-f]{7,40})$/;

/** One principles-review verdict: the PR, the head it names, when it was recorded and its violation count. */
export interface Verdict {
  number: number;
  head: string;
  at: number;
  /** Undefined for a verdict recorded before the count was. */
  findings: number | undefined;
}

/** An event that names a head of a pull request, a verdict or a send-back. */
export interface HeadNaming {
  number: number;
  head: string;
  at: number;
}

/** Every principles-review verdict the ledger holds, in ledger order; a re-review is not one. */
export function verdictsOf(events: LedgerEvent[]): Verdict[] {
  return events.flatMap((e) => {
    const head = VERDICT.exec(e.label ?? "")?.[1];
    if (
      e.kind !== "review.run" ||
      e.number === undefined ||
      head === undefined
    ) {
      return [];
    }
    return [
      {
        number: e.number,
        head: head.slice(0, HEAD_LENGTH),
        at: time(e),
        findings: e.findings,
      },
    ];
  });
}

/** The head a send-back's label names, or undefined when it names none. */
export function sendBackHeadOf(event: LedgerEvent): string | undefined {
  return SEND_BACK_HEAD.exec(event.label ?? "")?.[1]?.slice(0, HEAD_LENGTH);
}

/** The verdicts and the send-backs that name a head, each with its PR; a send-back with no PR is left out. */
export function headNamings(events: LedgerEvent[]): HeadNaming[] {
  const verdicts = verdictsOf(events).map(({ number, head, at }) => ({
    number,
    head,
    at,
  }));
  const sendBacks = events.flatMap((e) => {
    const head = sendBackHeadOf(e);
    return e.kind === "send-back" &&
      e.number !== undefined &&
      head !== undefined
      ? [{ number: e.number, head, at: time(e) }]
      : [];
  });
  return [...verdicts, ...sendBacks];
}

/**
 * Whether a change merged at `mergedAt` has a verdict for its head: the newest head named for the PR
 * at or before the merge, with a verdict recorded for that head at or before it. A verdict on an
 * older head does not count for a later one, and a change counts once however many verdicts it has.
 */
export function isReviewedAtHead(
  number: number,
  mergedAt: number,
  verdicts: Verdict[],
  namings: HeadNaming[],
): boolean {
  const before = namings
    .filter((n) => n.number === number && n.at <= mergedAt)
    .sort((a, b) => a.at - b.at);
  const head = before.at(-1)?.head;
  return (
    head !== undefined &&
    verdicts.some(
      (v) => v.number === number && v.head === head && v.at <= mergedAt,
    )
  );
}
