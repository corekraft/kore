import { JudgeError } from "../judge/index.js";

/** Where a session's text is read from: the herdr pane it settled in, or the summary an hc report carried. */
export type Backend = "herdr" | "hc";

/** Runs `harness` with these arguments and returns its stdout, or refuses with the fix. */
export type Harness = (...args: string[]) => Promise<string>;

/** Runs a command in the checkout and returns its stdout, or refuses with the fix. */
export type Tool = (
  command: string,
  args: string[],
  what: string,
) => Promise<string>;

/** `session wait --json`: a herdr session names its pane; an hc session names the summary of its report, when it wrote one. */
interface Settled {
  outcome: "done" | "blocked";
  paneId?: string;
  summary?: string;
}

/** The wait and read ports of the sessions a review starts, read by session name. */
export interface SettledReads {
  wait(name: string): Promise<{ outcome: "done" | "blocked" }>;
  read(name: string): Promise<string>;
}

/** The text of a settled session: the pane it ran in on herdr, or the summary its wait printed on hc. */
async function textOf(
  name: string,
  waited: Settled,
  backend: Backend,
  tool: Tool,
): Promise<string> {
  if (backend === "hc") {
    if (waited.summary === undefined) {
      throw new JudgeError(
        `The session ${name} settled without a report, so its text is not read. Rerun it; its last action must be \`harness session report\`.`,
      );
    }
    return waited.summary;
  }
  if (waited.paneId === undefined) {
    throw new JudgeError(
      `The session ${name} named no pane, so its text is not read. Rerun the session.`,
    );
  }
  return tool(
    "herdr",
    ["pane", "read", waited.paneId, "--source", "recent-unwrapped"],
    `herdr pane read of session ${name}`,
  );
}

/**
 * The wait and read ports of a session, kept by its name so a read refuses a session it has
 * not waited for. An hc terminal is never read by pane: its text is the summary its wait printed.
 */
export function settledReads(
  harness: Harness,
  tool: Tool,
  backend: Backend,
): SettledReads {
  const settled = new Map<string, Settled>();
  return {
    wait: async (name) => {
      const waited = JSON.parse(
        await harness("session", "wait", name, "--json"),
      ) as Settled;
      settled.set(name, waited);
      return { outcome: waited.outcome };
    },
    read: async (name) => {
      const waited = settled.get(name);
      if (waited === undefined) {
        throw new JudgeError(
          `The session ${name} has not settled, so its text is not read. Wait for it first with \`harness session wait ${name}\`.`,
        );
      }
      return textOf(name, waited, backend, tool);
    },
  };
}
