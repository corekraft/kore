import type { Ledger } from "../ledger/index.js";
import { HarnessCliError } from "./harness-cli.js";
import { TICK_ENV } from "./tick-cli.js";

/**
 * The dedupe record of a branch update notice, kept as a session.send event under its idea with the
 * notice's key as its label. It reads no event but this one, so a plain send never counts as a notice
 * (#980). The tick is the sender: it writes the record, and `session send` writes its own event.
 */
export class BranchLedger {
  constructor(
    private readonly ledger: Pick<Ledger, "list" | "record">,
    private readonly now: () => string,
  ) {}

  /** Whether a notice with this key was already recorded for the idea. */
  async sent(idea: string, key: string): Promise<boolean> {
    const { events } = await this.ledger.list({
      kind: "session.send",
      idea,
    });
    return events.some((event) => event.label === key);
  }

  /** Records the sent notice under its key, naming the writer and the tick as sender. */
  async record(event: {
    idea: string;
    key: string;
    writer: string;
  }): Promise<void> {
    const written = await this.ledger.record({
      source: "claude",
      kind: "session.send",
      occurredAt: this.now(),
      agent: event.writer,
      idea: event.idea,
      label: event.key,
      senderRole: TICK_ENV.KORE_ROLE,
      senderName: TICK_ENV.KORE_AGENT,
    });
    if (!written.ok) {
      throw new HarnessCliError(written.message);
    }
  }
}
