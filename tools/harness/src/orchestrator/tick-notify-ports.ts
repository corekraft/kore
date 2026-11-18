import type { Ledger, LedgerEvent } from "../ledger/index.js";
import type { Sender } from "../sender/index.js";
import { HarnessCliError } from "./harness-cli.js";
import type { OpenQuestion, PersonStep, NotifyPorts } from "./tick-notify.js";

const time = (event: LedgerEvent): number => Date.parse(event.occurredAt);

/** Whether the owner has replied on the question's issue since it was asked (ADR 0120, #854). */
function answered(
  question: LedgerEvent,
  replies: readonly LedgerEvent[],
): boolean {
  return (
    question.number !== undefined &&
    replies.some(
      (reply) =>
        reply.number === question.number && time(reply) >= time(question),
    )
  );
}

/** Whether a reserved notice was recorded after the question was asked, so it was already told. */
function noticed(
  question: LedgerEvent,
  sends: readonly LedgerEvent[],
): boolean {
  return sends.some(
    (send) => send.label === "reserved" && time(send) > time(question),
  );
}

/**
 * The notifier's dedup reads and its recorded sends, kept in the ledger as session.send events that
 * name the idea and the state, so a restart or the next pass finds them (ADR 0121).
 */
export class NotifyLedger implements Pick<
  NotifyPorts,
  "sent" | "openQuestions" | "record"
> {
  constructor(
    private readonly ledger: Pick<Ledger, "list" | "record">,
    private readonly now: () => string,
  ) {}

  async sent(idea: string, state: PersonStep): Promise<boolean> {
    const { events } = await this.ledger.list({
      kind: "session.send",
      idea,
    });
    return events.some((event) => event.label === state);
  }

  /**
   * The owner-routed questions on the idea that are still open: no owner reply on their issue came
   * after them, and no reserved notice was recorded after them. Reads the replies and notices only
   * when a question is routed to the owner.
   */
  async openQuestions(idea: string): Promise<OpenQuestion[]> {
    const { events: routed } = await this.ledger.list({
      kind: "decision.routed",
      idea,
    });
    const questions = routed.filter((event) => event.route === "owner");
    if (questions.length === 0) {
      return [];
    }
    const { events: replies } = await this.ledger.list({
      kind: "owner.replied",
    });
    const { events: sends } = await this.ledger.list({
      kind: "session.send",
      idea,
    });
    return questions
      .filter((q) => !answered(q, replies) && !noticed(q, sends))
      .map((q) => ({ occurredAt: q.occurredAt }));
  }

  async record(event: {
    idea: string;
    state: PersonStep;
    pane: string;
    sender: Sender;
  }): Promise<void> {
    const written = await this.ledger.record({
      source: "claude",
      kind: "session.send",
      occurredAt: this.now(),
      pane: event.pane,
      idea: event.idea,
      label: event.state,
      ...(event.sender.session === undefined
        ? {}
        : {
            senderRole: event.sender.session.role,
            senderName: event.sender.session.name,
          }),
    });
    if (!written.ok) {
      throw new HarnessCliError(written.message);
    }
  }
}
