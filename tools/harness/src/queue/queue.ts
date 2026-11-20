import type { IdeaRecord } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";

/** Judge send-backs on one PR after which its writer is relaunched on the stronger model (ADR 0078). */
export const ESCALATION_THRESHOLD = 2;
export const ESCALATION_MODEL = "claude-sonnet-5-5";

export type QueueItem =
  | { kind: "idea"; idea: string; issue: number; since: string }
  | { kind: "send-back"; pr: number; count: number; since: string }
  | {
      kind: "ticket";
      issue: number;
      since: string;
      lane: "product" | "harness";
      horizon: "next" | "then" | "none";
      labels: readonly string[];
      /** The PR that refers to this ticket and has merged; the ticket waits on it, so it is not queued work (#1431). */
      merged?: number;
    };

export type SendBackItem = Extract<QueueItem, { kind: "send-back" }>;

export interface OpenPr {
  number: number;
  /** The PR's head commit, full or abbreviated. */
  head: string;
}

const sendBacksOf = (events: readonly LedgerEvent[], pr: number) =>
  events.filter((e) => e.kind === "send-back" && e.number === pr);

/** The abbreviated head a send-back's ledger label ends with (reason, then @sha7). */
const headOf = (label: string | undefined): string | undefined =>
  /@([0-9a-f]{7,40})$/.exec(label ?? "")?.[1];

/**
 * How many times the judge sent this PR back: one per distinct PR head, so a
 * second send-back at the same head does not count twice. A send-back that
 * names no head counts on its own.
 */
export const countSendBacks = (
  events: readonly LedgerEvent[],
  pr: number,
): number =>
  new Set(
    sendBacksOf(events, pr).map((e) => headOf(e.label) ?? `event:${e.id}`),
  ).size;

/** The model a writer launches on: the default until the PR has been sent back twice, then Sonnet. */
export function writerTier(
  count: number,
  defaultModel: string,
): { model: string; escalate: boolean } {
  const escalate = count >= ESCALATION_THRESHOLD;
  return { model: escalate ? ESCALATION_MODEL : defaultModel, escalate };
}

const issueNumber = (ref: string | undefined): number | undefined => {
  const found = /(\d+)$/.exec(ref ?? "")?.[1];
  return found === undefined ? undefined : Number(found);
};

export interface QueueInput {
  ideas: readonly IdeaRecord[];
  /** Open issues carrying the approval label, with when each was created. */
  approved: ReadonlyMap<number, string>;
  openPrs: readonly OpenPr[];
  sendBacks: readonly LedgerEvent[];
}

/**
 * The send-backs still waiting for a writer, oldest first: a send-back is pending
 * while its PR is open and still at the head the judge sent back.
 */
export function pendingSendBacks(
  openPrs: readonly OpenPr[],
  sendBacks: readonly LedgerEvent[],
): SendBackItem[] {
  const items: SendBackItem[] = [];
  for (const pr of openPrs) {
    const events = sendBacksOf(sendBacks, pr.number);
    const newest = events.reduce<LedgerEvent | undefined>(
      (latest, e) =>
        latest === undefined ||
        Date.parse(e.occurredAt) >= Date.parse(latest.occurredAt)
          ? e
          : latest,
      undefined,
    );
    const head = headOf(newest?.label);
    if (
      newest !== undefined &&
      head !== undefined &&
      pr.head.startsWith(head)
    ) {
      items.push({
        kind: "send-back",
        pr: pr.number,
        count: countSendBacks(events, pr.number),
        since: newest.occurredAt,
      });
    }
  }
  return items.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

/**
 * The work the orchestrator may pick up, oldest first: approved ideas with no
 * outcome, and send-backs still waiting for a writer. A send-back is pending
 * while its PR is open and still at the head the judge sent back.
 */
export function buildQueue(input: QueueInput): QueueItem[] {
  const items: QueueItem[] = [];
  for (const record of input.ideas) {
    const issue = issueNumber(record.issue);
    const since = issue === undefined ? undefined : input.approved.get(issue);
    if (
      issue !== undefined &&
      since !== undefined &&
      record.outcome === undefined
    ) {
      items.push({ kind: "idea", idea: record.number, issue, since });
    }
  }
  items.push(...pendingSendBacks(input.openPrs, input.sendBacks));
  return items.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}
