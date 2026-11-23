import { JudgeError } from "../judge/index.js";

/** Runs `harness` with these arguments and returns its stdout, or refuses with the fix. */
export type Harness = (...args: string[]) => Promise<string>;

/** `session wait --json`: a session names the summary of its report, when it wrote one. */
interface Settled {
  outcome: "done" | "blocked";
  summary?: string;
}

/** The wait and read ports of the sessions a review starts, read by session name. */
export interface SettledReads {
  wait(name: string): Promise<{ outcome: "done" | "blocked" }>;
  read(name: string): Promise<string>;
}

/** The text of a settled session: the summary its report carried. */
function textOf(name: string, waited: Settled): string {
  if (waited.summary === undefined) {
    throw new JudgeError(
      `The session ${name} settled without a report, so its text is not read. Rerun it; its last action must be \`node skills/bin/harness.mjs session report\`.`,
    );
  }
  return waited.summary;
}

/**
 * The wait and read ports of a session, kept by its name so a read refuses a session it has not waited for.
 * A session's text is the summary its report carried, never a read of its terminal.
 */
export function settledReads(harness: Harness): SettledReads {
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
      return textOf(name, waited);
    },
  };
}
