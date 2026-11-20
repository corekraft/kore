import {
  type ExclusionReason,
  type Frontier,
  type FrontierItem,
} from "../queue/index.js";
import { QueueError } from "./queue-error.js";

/** One frontier line's words: the kind, what it is, its lane and horizon, and when it was queued. */
const describeFrontierItem = (item: FrontierItem): string => {
  if (item.kind === "send-back") {
    return `send-back PR #${item.pr} lane - horizon - since ${item.since}`;
  }
  const subject =
    item.kind === "idea"
      ? `idea ${item.idea} (issue #${item.issue})`
      : `ticket issue #${item.issue}`;
  return `${subject} lane ${item.lane} horizon ${item.horizon} since ${item.since}`;
};

/** Why each exclusion keeps an issue out, in words a person can act on. */
const REASONS: Record<ExclusionReason, string> = {
  "not-ready": "it lacks the ready-for-agent label",
  assigned: "it has an assignee",
  paused: "it has the paused label",
  spec: "it has the spec label",
  blocked: "it has an open blocker",
  "sub-issue": "it has sub-issues, so it is a parent, not a ticket",
  "grilling-source":
    "its body starts with Filed by, so it is a grilling source",
  "idea-outcome": "its idea record already has an outcome",
  "idea-missing": "no idea record matches this idea issue",
};

/** A ticket whose PR has merged: it waits on that PR, so it is not queued work (#1431). */
const isWaiting = (
  item: FrontierItem,
): item is FrontierItem & { kind: "ticket"; merged: number } =>
  item.kind === "ticket" && item.merged !== undefined;

/** The steering view: one numbered line per queued item in queue order, a waiting line per merged ticket, or the whole frontier as JSON. */
export function renderFrontier(frontier: Frontier, json: boolean): string {
  if (json) {
    return `${JSON.stringify({ queue: frontier.queue, excluded: frontier.excluded })}\n`;
  }
  if (frontier.queue.length === 0) {
    return "The queue is empty.\n";
  }
  let position = 0;
  return frontier.queue
    .map((item) => {
      if (isWaiting(item)) {
        return `ticket issue #${item.issue} waiting: merged PR #${item.merged}\n`;
      }
      position += 1;
      return `${position}. ${describeFrontierItem(item)}\n`;
    })
    .join("");
}

/** The issue `--explain` names: a positive issue number, else a refusal naming the fix. */
export function explainedIssue(
  raw: string | boolean | undefined,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "string" || !/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new QueueError(
      "Missing or invalid issue number. Run `harness queue next --explain <issue>`.",
    );
  }
  return Number(raw);
}

/** One issue's place in the frontier: waiting on its merged PR, queued at a position, excluded with its reason, or absent. */
export function explanation(issue: number, frontier: Frontier) {
  const steering = frontier.queue.filter((item) => !isWaiting(item));
  const waiting = frontier.queue.find(
    (item): item is FrontierItem & { kind: "ticket"; merged: number } =>
      isWaiting(item) && item.issue === issue,
  );
  if (waiting !== undefined) {
    return {
      json: { issue, status: "waiting", pr: waiting.merged },
      text: `issue #${issue} is waiting: merged PR #${waiting.merged}`,
    };
  }
  const placed = steering
    .flatMap((item, index) =>
      item.kind === "send-back" ? [] : [{ item, position: index + 1 }],
    )
    .find((entry) => entry.item.issue === issue);
  if (placed !== undefined) {
    const { item, position } = placed;
    return {
      json: { issue, status: "queued", position, item },
      text: `issue #${issue} is queued at position ${position} of ${steering.length}: ${item.kind}, lane ${item.lane}, horizon ${item.horizon}`,
    };
  }
  const excluded = frontier.excluded.find((e) => e.issue === issue);
  if (excluded !== undefined) {
    return {
      json: { issue, status: "excluded", reason: excluded.reason },
      text: `issue #${issue} is excluded: ${REASONS[excluded.reason]}`,
    };
  }
  return {
    json: { issue, status: "absent" },
    text: `issue #${issue} is not queued: it lacks the ready-for-agent label, or is not open`,
  };
}
