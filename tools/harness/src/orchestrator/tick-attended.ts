import type { Terminal, TerminalError, Terminals } from "../terminal/index.js";
import { HarnessCliError } from "./harness-cli.js";

/** The label on the one live agent terminal the tick tells when an idea needs a person (plan 16, Step 4). */
const ATTENDED = "kore-attended";

/** hc's message for an error: its message, with its hint in brackets when hc gives one. */
function messageOf(error: TerminalError): string {
  const { message, hint } = error.error;
  return hint === undefined ? message : `${message} (${hint})`;
}

/**
 * The one live agent terminal labelled kore-attended=1, the only terminal the tick types a notice
 * into. A terminal that reports no status is a shell, not an agent, so it is never typed into.
 */
export class AttendedTerminal {
  constructor(private readonly terminals: Pick<Terminals, "list" | "send">) {}

  /**
   * The id of the one live agent terminal labelled kore-attended=1. Undefined when none is, so
   * nothing is typed and nothing is recorded. Two or more is refused, naming the labels to fix.
   */
  async attendedPane(): Promise<string | undefined> {
    const listed = await this.terminals.list({ labels: { [ATTENDED]: "1" } });
    if ("error" in listed) {
      throw new HarnessCliError(messageOf(listed));
    }
    const agents: Terminal[] = listed.filter(
      (terminal) => terminal.state === "live" && terminal.status !== undefined,
    );
    if (agents.length > 1) {
      const ids = agents.map((terminal) => terminal.id).join(", ");
      throw new HarnessCliError(
        `${agents.length} live agent terminals are labelled ${ATTENDED}=1 (${ids}), so the notice has no one attended terminal. Label all but one ${ATTENDED}=0 with hc label <id> ${ATTENDED}=0, so exactly one is ${ATTENDED}=1.`,
      );
    }
    return agents[0]?.id;
  }

  /** Types one line into the attended terminal; undefined once it is sent, else hc's message. */
  async send(pane: string, body: string): Promise<string | undefined> {
    const sent = await this.terminals.send(pane, body);
    return "error" in sent ? messageOf(sent) : undefined;
  }
}
