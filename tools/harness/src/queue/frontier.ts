import type { IdeaRecord } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import {
  exclusionOf,
  type ExclusionReason,
  type FrontierIssue,
} from "./exclusion.js";
import {
  HARNESS_LABEL,
  HORIZON_NEXT_LABEL,
  HORIZON_THEN_LABEL,
  IDEA_MARKER,
} from "./labels.js";
import {
  pendingSendBacks,
  type OpenPr,
  type QueueItem,
  type SendBackItem,
} from "./queue.js";

export type Lane = "product" | "harness";
export type Horizon = "next" | "then" | "none";

/** A plain ticket in the frontier: the tick does not start it yet, but the queue lists it with its labels. */
export type TicketItem = Extract<QueueItem, { kind: "ticket" }>;

/** One place in the frontier: a send-back, an idea, or a plain ticket. */
export type FrontierItem =
  | SendBackItem
  | {
      kind: "idea";
      idea: string;
      issue: number;
      since: string;
      lane: Lane;
      horizon: Horizon;
    }
  | TicketItem;

export interface Excluded {
  issue: number;
  reason: ExclusionReason;
}

export interface Frontier {
  queue: FrontierItem[];
  excluded: Excluded[];
}

export interface FrontierInput {
  issues: readonly FrontierIssue[];
  ideas: readonly IdeaRecord[];
  openPrs: readonly OpenPr[];
  sendBacks: readonly LedgerEvent[];
}

const issueNumber = (ref: string | undefined): number | undefined => {
  const found = /(\d+)$/.exec(ref ?? "")?.[1];
  return found === undefined ? undefined : Number(found);
};

const laneOf = (labels: readonly string[]): Lane =>
  labels.includes(HARNESS_LABEL) ? "harness" : "product";

const horizonOf = (labels: readonly string[]): Horizon => {
  if (labels.includes(HORIZON_NEXT_LABEL)) {
    return "next";
  }
  return labels.includes(HORIZON_THEN_LABEL) ? "then" : "none";
};

const LANES: readonly Lane[] = ["product", "harness"];
const HORIZONS: readonly Horizon[] = ["next", "then", "none"];

type Issued = Exclude<FrontierItem, SendBackItem>;

/** Product before harness, then horizon:next, horizon:then, neither; then oldest, then lowest number. */
function compareIssues(a: Issued, b: Issued): number {
  return (
    LANES.indexOf(a.lane) - LANES.indexOf(b.lane) ||
    HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon) ||
    Date.parse(a.since) - Date.parse(b.since) ||
    a.issue - b.issue
  );
}

/**
 * The deterministic frontier: pending send-backs first, oldest first; then every
 * open ready-for-agent issue that no exclusion rule keeps out, ordered product
 * before harness, horizon:next before horizon:then before neither, oldest first,
 * lowest number on a tie. Each excluded issue is listed once with its reason.
 * Same issues in, same frontier out, whatever order they arrive in.
 */
export function buildFrontier(input: FrontierInput): Frontier {
  const ideas = new Map<number, IdeaRecord>();
  for (const record of input.ideas) {
    const number = issueNumber(record.issue);
    if (number !== undefined) {
      ideas.set(number, record);
    }
  }
  const issued: Issued[] = [];
  const excluded: Excluded[] = [];
  for (const issue of input.issues) {
    const idea = issue.body.trimStart().startsWith(IDEA_MARKER)
      ? ideas.get(issue.number)
      : undefined;
    const reason = exclusionOf(issue, idea);
    if (reason !== undefined) {
      excluded.push({ issue: issue.number, reason });
      continue;
    }
    const place = {
      issue: issue.number,
      since: issue.createdAt,
      lane: laneOf(issue.labels),
      horizon: horizonOf(issue.labels),
    };
    issued.push(
      idea === undefined
        ? { kind: "ticket", ...place, labels: issue.labels }
        : { kind: "idea", idea: idea.number, ...place },
    );
  }
  return {
    queue: [
      ...pendingSendBacks(input.openPrs, input.sendBacks),
      ...issued.sort(compareIssues),
    ],
    excluded: excluded.sort((a, b) => a.issue - b.issue),
  };
}
