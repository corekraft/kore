import type { Ledger } from "../ledger/index.js";
import type { Sender } from "../sender/index.js";
import { HarnessCliError } from "./harness-cli.js";
import type { PersonStep, NotifyPorts } from "./tick-notify.js";

/**
 * The notifier's dedup read and its recorded send, kept in the ledger as a session.send event that
 * names the idea and the state, so a restart or the next pass finds it (ADR 0121).
 */
export class NotifyLedger implements Pick<NotifyPorts, "sent" | "record"> {
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
