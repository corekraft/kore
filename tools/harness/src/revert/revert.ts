import { IdeaError } from "../idea/index.js";
import type { Result } from "../outcome/index.js";

export interface RevertChange {
  /** The idea's number, as the ledger names it. */
  idea: string;
  /** The idea's issue number. */
  issue: number;
  /** The merged PR that delivered the change. */
  pr: number;
}

export interface RevertPr {
  number: number;
  url: string;
}

/** Every side effect a revert has; each is faked in specs. */
export interface RevertPorts {
  /** Whether the local overlay turns the flag on. */
  flagOn(): Promise<boolean>;
  /** Whether the ledger already holds a harness-change-reverted event for the idea. */
  reverted(idea: string): Promise<boolean>;
  /** A revert PR already open or merged for the issue's branch. */
  existing(issue: number): Promise<RevertPr | undefined>;
  /** Whether the change edited the guardrail inventory. */
  touchesGuardrail(pr: number): Promise<boolean>;
  /** Opens the revert PR; never merges it. */
  prepare(change: RevertChange): Promise<RevertPr>;
  /** Appends the harness-change-reverted event through the ledger. */
  record(idea: string, number: number): Promise<void>;
}

export type RevertResult =
  | {
      status: "not-refuted" | "flag-off" | "already-reverted" | "guardrail";
    }
  | { status: "prepared" | "already-prepared"; number: number; url: string };

/**
 * Prepares the revert of a refuted harness change. A confirmed or inconclusive
 * outcome reverts nothing, a flag that is off prepares nothing, and an idea is
 * reverted once. It opens a PR and stops: the judge approves and merges it.
 */
export class PrepareRevert {
  constructor(private readonly ports: RevertPorts) {}

  async run(
    input: Omit<RevertChange, "pr"> & {
      pr: number | undefined;
      result: Result;
    },
  ): Promise<RevertResult> {
    if (input.result !== "refuted") {
      return { status: "not-refuted" };
    }
    if (!(await this.ports.flagOn())) {
      return { status: "flag-off" };
    }
    const { pr } = input;
    if (pr === undefined) {
      throw new IdeaError(
        `The ledger gave no PR for idea ${input.idea}'s change, so there is nothing to revert; rerun \`harness evaluate --idea ${input.idea} --changed-by-pr <number>\`.`,
      );
    }
    if (!Number.isSafeInteger(input.issue) || input.issue < 1) {
      throw new IdeaError(
        `Idea ${input.idea}'s issue is not a number, so its revert branch cannot be named; run \`harness idea sync\`, then rerun \`harness evaluate\`.`,
      );
    }
    if (await this.ports.reverted(input.idea)) {
      return { status: "already-reverted" };
    }
    const found = await this.ports.existing(input.issue);
    if (found !== undefined) {
      await this.ports.record(input.idea, found.number);
      return { status: "already-prepared", ...found };
    }
    if (await this.ports.touchesGuardrail(pr)) {
      return { status: "guardrail" };
    }
    const made = await this.ports.prepare({
      idea: input.idea,
      issue: input.issue,
      pr,
    });
    await this.ports.record(input.idea, made.number);
    return { status: "prepared", ...made };
  }
}
