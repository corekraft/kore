// The owner digest (ADR 0120): at most one a day, posted to the one issue pinned for it, listing
// the open reserved questions (blocking first) and saying when the tick is not running. It is
// posted as a comment, never typed into a pane, and it does nothing while the decision-advisor
// flag is off.
import type { LedgerEvent } from "../ledger/index.js";
import { tickHeartbeat } from "../orchestrator/index.js";
import { signedBody } from "../sender/index.js";
import { DECISION_FLAG, DecisionError } from "./decision.js";
import { openOwnerQuestions, type OwnerQuestion } from "./owner-queue.js";

/** The most often a digest is posted; a placeholder the owner may tune (ADR 0120). */
export const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The issue the digest is posted to: the one issue pinned on the repository. */
export interface DigestTarget {
  readonly number: string;
  readonly repo: string;
}

export interface DigestPorts {
  /** The spawn environment the sender line is read from. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly flagOn: () => Promise<boolean>;
  /** The pinned issue. Throws a DecisionError when none or several are pinned, saying which to fix. */
  readonly pinned: () => Promise<DigestTarget>;
  /** Posts the comment and returns its URL. */
  readonly post: (target: DigestTarget, body: string) => Promise<string>;
  /** Records decision.digest at the given time; carries no question or reasoning. */
  readonly record: (
    at: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export interface DigestInput {
  /** The ledger's events, read once by the caller. */
  readonly events: readonly LedgerEvent[];
  readonly now: Date;
}

export type DigestResult =
  | {
      readonly posted: true;
      readonly commentUrl: string;
      readonly open: number;
      readonly blocking: number;
      readonly tickGap: boolean;
    }
  | {
      readonly posted: false;
      readonly reason: "not-due";
      readonly nextAt: string;
    }
  | { readonly posted: false; readonly reason: "nothing-to-report" };

/** The latest decision.digest the ledger holds, or undefined when none was posted. */
function lastDigest(events: readonly LedgerEvent[]): string | undefined {
  const times = events
    .filter((event) => event.kind === "decision.digest")
    .map((event) => event.occurredAt);
  return times.length === 0
    ? undefined
    : times.reduce((latest, at) =>
        Date.parse(at) > Date.parse(latest) ? at : latest,
      );
}

/** Whether a digest may be posted now: none has been, or the last is at least a day old. */
export function digestDue(events: readonly LedgerEvent[], now: Date): boolean {
  const last = lastDigest(events);
  return (
    last === undefined || now.getTime() - Date.parse(last) >= DIGEST_INTERVAL_MS
  );
}

function line(question: OwnerQuestion): string {
  return `- idea ${question.idea} (${question.category}), asked ${question.since}`;
}

/** The digest's text: the counts, the blocking questions, the open ones, then the tick's gap if any. */
function digestText(
  questions: readonly OwnerQuestion[],
  gapSince: string | undefined,
): string {
  const blocking = questions.filter((question) => question.blocking);
  const open = questions.filter((question) => !question.blocking);
  const plural = questions.length === 1 ? "question" : "questions";
  const header =
    questions.length === 0
      ? "Owner digest: no open reserved questions."
      : `Owner digest: ${questions.length} open reserved ${plural}, ${blocking.length} blocking.`;
  const sections = [header];
  if (blocking.length > 0) {
    sections.push(`Blocking:\n${blocking.map(line).join("\n")}`);
  }
  if (open.length > 0) {
    sections.push(`Open:\n${open.map(line).join("\n")}`);
  }
  if (gapSince !== undefined) {
    sections.push(`the tick is not running: no heartbeat since ${gapSince}`);
  }
  return sections.join("\n\n");
}

/**
 * Posts the owner digest once a day, when a question is open or the tick is not running. Refused
 * with nothing posted while the flag is off; the pinned issue is read only when a digest is due.
 */
export async function postDigest(
  ports: DigestPorts,
  input: DigestInput,
): Promise<DigestResult> {
  if (!(await ports.flagOn())) {
    throw new DecisionError(
      `The ${DECISION_FLAG} flag is off, so no digest is posted. It is turned on only with \`harness flag activate ${DECISION_FLAG}\`.`,
    );
  }
  const last = lastDigest(input.events);
  if (!digestDue(input.events, input.now) && last !== undefined) {
    return {
      posted: false,
      reason: "not-due",
      nextAt: new Date(Date.parse(last) + DIGEST_INTERVAL_MS).toISOString(),
    };
  }
  const questions = openOwnerQuestions(input.events);
  const tick = tickHeartbeat(input.events, input.now);
  const gapSince = tick.state === "gap" ? tick.lastAt : undefined;
  if (questions.length === 0 && gapSince === undefined) {
    return { posted: false, reason: "nothing-to-report" };
  }
  const signed = signedBody(
    ports.env,
    "decision digest",
    digestText(questions, gapSince),
  );
  if ("error" in signed) {
    throw new DecisionError(signed.error);
  }
  const target = await ports.pinned();
  const commentUrl = await ports.post(target, signed.body);
  const recorded = await ports.record(input.now.toISOString());
  if (!recorded.ok) {
    throw new DecisionError(
      `The digest was posted at ${commentUrl}, but its ledger event was rejected: ${recorded.message} Do not post the digest again.`,
    );
  }
  return {
    posted: true,
    commentUrl,
    open: questions.length,
    blocking: questions.filter((question) => question.blocking).length,
    tickGap: gapSince !== undefined,
  };
}
