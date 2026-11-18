import { signedMessage, type Sender } from "../sender/index.js";
import { HarnessCliError } from "./harness-cli.js";
import type { IdeaStep, StepName } from "./tick.js";

/**
 * The notifier's states at which an idea needs a person (ADR 0121): the tick cannot go on without
 * the owner. The step ends are a subset of the ends `orchestrate run` stops at; a judge pane's wait
 * is not a person. `reserved` is not a step: it is an owner-routed question open on the idea (#1058).
 */
export const NEEDS_A_PERSON = [
  "blocked",
  "needs-judgment",
  "needs-info",
  "reserved",
] as const;

export type PersonStep = (typeof NEEDS_A_PERSON)[number];

/** Whether a step is one at which an idea needs a person. */
export function needsAPerson(
  step: StepName,
): step is Exclude<PersonStep, "reserved"> {
  return (NEEDS_A_PERSON as readonly string[]).includes(step);
}

/** The reason each person state names in its message, once per idea and state. */
const REASONS: Record<PersonStep, string> = {
  blocked:
    "a pane ended blocked, or a writer left no pull request; the owner decides",
  "needs-judgment":
    "a third send-back went to a judgment pane that already ran; the owner decides",
  "needs-info":
    "the judgment flow stopped it and labelled the idea needs-info; the owner decides",
  reserved:
    "a reserved question waits on the owner's reply on the idea's issue; the owner decides",
};

/** An owner-routed question on the idea that nobody has answered, with when it was asked. */
export interface OpenQuestion {
  occurredAt: string;
}

/** The ports a notification needs: the attended pane, the dedup record, delivery, and the recorded send. */
export interface NotifyPorts {
  /** The pane the idea's sessions were spawned from, read from the session registry; undefined when none is recorded. */
  attendedPane: (idea: string) => Promise<string | undefined>;
  /** Whether this idea and state were already sent, read from the ledger. */
  sent: (idea: string, state: PersonStep) => Promise<boolean>;
  /**
   * The owner's reserved questions on the idea that no reply has answered and no reserved notice
   * has come after; empty when none needs telling (#1058). Read from the ledger in one call.
   */
  openQuestions: (idea: string) => Promise<readonly OpenQuestion[]>;
  /** Delivers one line to the pane through the signed send path; an error message, or undefined once delivered. */
  send: (pane: string, body: string) => Promise<string | undefined>;
  /** Records the send with its idea, state, pane and sender, so the next pass finds it. */
  record: (event: {
    idea: string;
    state: PersonStep;
    pane: string;
    sender: Sender;
  }) => Promise<void>;
}

/**
 * Tells the attended pane once when an idea needs a person. It sends nothing for any other step,
 * nothing when the idea and state were already sent, and nothing when no pane is recorded for it.
 */
export class TickNotifier {
  constructor(
    private readonly ports: NotifyPorts,
    /** The tick's spawn environment, which names the sender line the message carries. */
    private readonly env: Readonly<Record<string, string | undefined>>,
    /** The harness command the sender line names. */
    private readonly command: string,
  ) {}

  async notify(step: IdeaStep): Promise<void> {
    // A reserved question is checked on every step, since the question waits on the owner, not on the step.
    await this.notifyReserved(step.idea);
    if (!needsAPerson(step.step)) {
      return;
    }
    const { idea } = step;
    const state = step.step;
    if (await this.ports.sent(idea, state)) {
      return;
    }
    await this.tell(idea, state);
  }

  /** Tells the attended pane once for the open reserved questions on the idea (#1058). */
  private async notifyReserved(idea: string): Promise<void> {
    if ((await this.ports.openQuestions(idea)).length === 0) {
      return;
    }
    await this.tell(idea, "reserved");
  }

  /** Sends the signed line for a state to the attended pane, then records the send; nothing when no pane is recorded. */
  private async tell(idea: string, state: PersonStep): Promise<void> {
    const pane = await this.ports.attendedPane(idea);
    if (pane === undefined) {
      return;
    }
    const signed = signedMessage(
      this.env,
      this.command,
      `Idea ${idea} needs a person: ${REASONS[state]}.`,
    );
    if ("error" in signed) {
      throw new HarnessCliError(signed.error);
    }
    const error = await this.ports.send(pane, signed.body);
    if (error !== undefined) {
      throw new HarnessCliError(
        `Could not tell the attended pane ${pane} that idea ${idea} needs a person: ${error}. Nothing was recorded, so the next pass tries again.`,
      );
    }
    await this.ports.record({
      idea,
      state,
      pane,
      sender: signed.sender,
    });
  }
}
