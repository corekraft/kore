import { formatSender, senderFrom } from "../sender/index.js";
import type { IdeaStep, StepNotifier } from "./tick-step.js";
import { isTicketKey } from "./tick-ticket.js";
import { TICK_COMMAND, TICK_ENV } from "./tick-cli.js";

/** The key a ticket's waiting comment goes by: one comment per merged PR on the ticket (#1431). */
export const waitingKey = (pr: number): string => `merged-pr:${pr}`;

/** The comment a ticket gets once its PR has merged: the sender line first, then what the ticket waits on and how to move it. */
export function waitingBody(line: string, pr: number, issue: number): string {
  return `${line}\nPR #${pr} merged, so issue #${issue} waits on a live proof or an owner step. Add the \`live-proof\` label for a live proof, add an assignee for an owner step, or close the issue.`;
}

/** The ports a waiting notice reads and writes: the dedupe record, the issue comment and the record of a posted comment. */
export interface WaitingPorts {
  /** Whether a waiting comment with this key was already recorded for the ticket's idea key. */
  sent: (idea: string, key: string) => Promise<boolean>;
  /** Posts the comment on the issue; an error message, or undefined once posted. */
  comment: (issue: number, body: string) => Promise<string | undefined>;
  /** Records the posted comment under its key, so a restart posts nothing twice. */
  record: (event: { idea: string; key: string }) => Promise<void>;
}

/**
 * Tells a plain ticket, once per merged PR, what its change is waiting on: a live proof or an owner
 * step, with the label, assignee or close that moves it (#1431). The tick signs the comment as itself
 * (TICK_ENV), never as the owner. It runs only on the tick's merged step of a ticket key, so an idea's
 * outcome steps are never touched.
 */
export class WaitingTicketNotice {
  constructor(private readonly ports: WaitingPorts) {}

  /** The report for this step, or undefined when there is nothing to say. */
  async check(step: IdeaStep): Promise<string | undefined> {
    if (
      step.step !== "merged" ||
      step.issue === undefined ||
      step.pr === undefined ||
      !isTicketKey(step.idea)
    ) {
      return undefined;
    }
    const { idea, issue, pr } = {
      idea: step.idea,
      issue: step.issue,
      pr: step.pr,
    };
    const key = waitingKey(pr);
    if (await this.ports.sent(idea, key)) {
      return undefined;
    }
    const sender = senderFrom(TICK_ENV, TICK_COMMAND);
    if ("error" in sender) {
      return `PR #${pr} merged, but the waiting comment on issue #${issue} was not posted: ${sender.error}`;
    }
    const error = await this.ports.comment(
      issue,
      waitingBody(formatSender(sender), pr, issue),
    );
    if (error !== undefined) {
      return `Issue #${issue}: the waiting comment for merged PR #${pr} was not posted: ${error}`;
    }
    await this.ports.record({ idea, key });
    return `Waiting comment posted on issue #${issue} for merged PR #${pr}.`;
  }
}

/** Runs the step's own notice, then adds the waiting report to the step's notice (#1431). */
export class WaitingStepNotifier implements StepNotifier {
  constructor(
    private readonly notifier: StepNotifier,
    private readonly waiting: Pick<WaitingTicketNotice, "check">,
  ) {}

  async notify(step: IdeaStep): Promise<void> {
    await this.notifier.notify(step);
    const notice = await this.waiting.check(step);
    if (notice !== undefined) {
      step.notice =
        step.notice === undefined ? notice : `${step.notice}\n${notice}`;
    }
  }
}
