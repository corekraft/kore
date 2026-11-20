import type { Ledger } from "../ledger/index.js";
import { HarnessCliError } from "./harness-cli.js";

/** The ledger kind a ticket's waiting comment is recorded under, labelled with its merged PR's key (#1431). */
export const WAITING_KIND = "ticket.waiting";

/** The dedupe record of a ticket's waiting comment: one ticket.waiting event per ticket and merged PR (#1431). */
export class WaitingLedger {
  constructor(
    private readonly ledger: Pick<Ledger, "list" | "record">,
    private readonly now: () => string,
  ) {}

  /** Whether a waiting comment with this key was already recorded for the ticket. */
  async sent(idea: string, key: string): Promise<boolean> {
    const { events } = await this.ledger.list({ kind: WAITING_KIND, idea });
    return events.some((event) => event.label === key);
  }

  /** Records the posted comment under its key, timed by the clock. */
  async record(event: { idea: string; key: string }): Promise<void> {
    const written = await this.ledger.record({
      source: "claude",
      kind: WAITING_KIND,
      occurredAt: this.now(),
      idea: event.idea,
      label: event.key,
    });
    if (!written.ok) {
      throw new HarnessCliError(
        `The ticket.waiting event was rejected: ${written.message}. Fix the ledger, then rerun orchestrate tick.`,
      );
    }
  }
}
