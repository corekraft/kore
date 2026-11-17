// The owner's replies to advisor decisions (ADR 0120). An untagged comment by the owner's login,
// the first after an advisor decision on the same issue, records advisor.overturned. Only ids,
// issue numbers and times are kept: never a body or a login.
import type { Runner } from "../runtime/index.js";
import { readSender } from "../sender/index.js";
import { pages, when, type Raw } from "./github-gh.js";
import { APPROVED_MARKER, REFUSED_MARKER } from "./github-owner-actions.js";
import type { EventInput } from "./schema.js";

/** The role and command a decision comment carries; decision-commands.ts posts it under them. */
const DECISION_ROLE = "advisor";
const DECISION_COMMAND = "decision make";

const bodyOf = (c: Raw): string =>
  typeof c["body"] === "string" ? c["body"] : "";

const isDecision = (body: string): boolean => {
  const sender = readSender(body);
  return (
    sender?.session?.role === DECISION_ROLE &&
    sender.command === DECISION_COMMAND
  );
};

/** Untagged, by the owner's login, and not a marker the harness posts for an approval or a refusal. */
const isOwnersReply = (c: Raw, body: string, owner: string): boolean =>
  readSender(body) === undefined &&
  (c["user"] as Raw | undefined)?.["login"] === owner &&
  !body.startsWith(APPROVED_MARKER) &&
  !body.startsWith(REFUSED_MARKER);

/**
 * The overturns one issue's comments record, in time order: the owner's first untagged reply
 * after each advisor decision. A tagged reply is never the owner's, and a decision takes one
 * overturn, so a second untagged reply before the next decision is not recorded.
 */
export function overturnEvents(
  issue: number,
  comments: Raw[],
  owner: string,
): EventInput[] {
  // GitHub's times share one format, so comparing them as text orders them in time.
  const timeOf = (c: Raw) => when(c["created_at"]) ?? "";
  const ordered = [...comments].sort((a, b) =>
    timeOf(a).localeCompare(timeOf(b)),
  );
  const out: EventInput[] = [];
  let open = false;
  for (const c of ordered) {
    const body = bodyOf(c);
    if (isDecision(body)) {
      open = true;
      continue;
    }
    const at = when(c["created_at"]);
    if (!open || at === undefined || !isOwnersReply(c, body, owner)) {
      continue;
    }
    open = false;
    out.push({
      id: `github:advisor.overturned:${String(c["id"])}`,
      source: "github",
      kind: "advisor.overturned",
      occurredAt: at,
      number: issue,
      idea: `#${issue}`,
    });
  }
  return out;
}

/**
 * The overturns recorded on each decided issue, read from its comments. Each issue is listed
 * whole, not since a time, because the decision may be older than the poll's window; a listing
 * that fails returns its message, so the poll fails with its cause.
 */
export async function fromOverturns(
  runner: Runner,
  repo: string,
  owner: string,
  issues: number[],
): Promise<EventInput[] | string> {
  const out: EventInput[] = [];
  for (const issue of issues) {
    const comments = await pages(
      runner,
      `api issues/${issue}/comments`,
      `repos/${repo}/issues/${issue}/comments`,
    );
    if (typeof comments === "string") {
      return comments;
    }
    out.push(...overturnEvents(issue, comments, owner));
  }
  return out;
}

/**
 * The issue numbers the decision.made events name, each once, in the order first seen. A decision
 * records the issue it was posted on; one recorded before that carries none and is skipped.
 */
export function decisionIssues(events: { number?: number }[]): number[] {
  const numbers = new Set<number>();
  for (const event of events) {
    if (event.number !== undefined) {
      numbers.add(event.number);
    }
  }
  return [...numbers];
}
