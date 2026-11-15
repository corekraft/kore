import type { IdeaRecord } from "../idea/index.js";
import type { Clock } from "../runtime/index.js";
import {
  APPROVED_MARKER,
  REFUSED_MARKER,
  type Ledger,
} from "../ledger/index.js";
import { qualify, type QualifyInput } from "./qualify.js";

/** An idea that cannot be judged or written to, with how to fix it. */
export class ApproveError extends Error {}

/** Every side effect an approval has; each is a harness tool or one gh call, faked in specs. */
export interface ApprovePorts {
  /** Whether the local overlay turns automatic approval on. */
  flagOn: () => Promise<boolean>;
  idea: (ref: string) => Promise<IdeaRecord>;
  /** The issue number an idea links to, or undefined when it has none. */
  issueOf: (record: IdeaRecord) => number | undefined;
  /** The flow report's metric names and trailing metrics. */
  metrics: () => Promise<QualifyInput>;
  labels: (issue: number) => Promise<string[]>;
  comments: (issue: number) => Promise<string[]>;
  comment: (issue: number, body: string) => Promise<void>;
  /** Adds the ready-for-agent label. */
  label: (issue: number) => Promise<void>;
  ledger: Pick<Ledger, "list" | "record">;
  clock: Clock;
}

export interface Approval {
  idea: string;
  issue: number;
  /** flag-off: nothing was written, and `reason` is what the verdict would have been. */
  status: "approved" | "already-approved" | "left-for-person" | "flag-off";
  reason: string;
}

const APPROVED = "ready-for-agent";

/**
 * Applies the approval label to a harness idea only when `qualify` says it is
 * reversible and measurable. Every write is skipped when already done, so a
 * rerun changes nothing; with the flag off it writes nothing at all.
 */
export class Approver {
  constructor(private readonly ports: ApprovePorts) {}

  async run(ref: string): Promise<Approval> {
    const { ports } = this;
    const record = await ports.idea(ref);
    const issue = ports.issueOf(record);
    if (issue === undefined) {
      throw new ApproveError(
        `Idea ${record.number} has no issue to label or comment on; run \`harness idea sync --idea ${record.number}\` first, then rerun.`,
      );
    }
    const verdict = qualify(record, await ports.metrics());
    const done = { idea: record.number, issue, reason: verdict.reason };
    if (!(await ports.flagOn())) {
      return { ...done, status: "flag-off" };
    }
    const body = `${verdict.approve ? APPROVED_MARKER : REFUSED_MARKER}\n${verdict.reason}`;
    const comments = await ports.comments(issue);
    if (!verdict.approve) {
      await this.post(issue, body, comments);
      return { ...done, status: "left-for-person" };
    }
    const labelled = (await ports.labels(issue)).includes(APPROVED);
    if (labelled && !comments.includes(body)) {
      // A person's label: it is theirs, so no comment and no event claim it.
      return { ...done, status: "already-approved" };
    }
    const wrote = [
      await this.post(issue, body, comments),
      await this.apply(issue, labelled),
      await this.record(issue, record, ref),
    ];
    return {
      ...done,
      status: wrote.includes(true) ? "approved" : "already-approved",
    };
  }

  private async post(issue: number, body: string, comments: string[]) {
    if (comments.includes(body)) {
      return false;
    }
    await this.ports.comment(issue, body);
    return true;
  }

  private async apply(issue: number, labelled: boolean) {
    if (labelled) {
      return false;
    }
    await this.ports.label(issue);
    return true;
  }

  private async record(issue: number, record: IdeaRecord, ref: string) {
    const { ledger, clock } = this.ports;
    const { events } = await ledger.list({ kind: "auto-approved" });
    if (events.some((e) => e.number === issue)) {
      return false;
    }
    const written = await ledger.record({
      source: "claude",
      kind: "auto-approved",
      occurredAt: clock.now().toISOString(),
      idea: `#${issue}`,
      number: issue,
      label: record.harness?.metric ?? "unknown",
    });
    if (!written.ok) {
      throw new ApproveError(
        `The auto-approved event was rejected: ${written.message} Fix the ledger, then rerun \`harness approve --idea ${ref}\`.`,
      );
    }
    return true;
  }
}
