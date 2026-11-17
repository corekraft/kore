import type { ReadRequest } from "./judgment-check.js";

/** One reader's summary, named by the pane that printed it, for a judgment pane's next brief. */
export interface ReaderSummary {
  name: string;
  text: string;
}

/** What a judgment pane is started to decide: its first decision, a retry after a refusal, or the summaries its reads brought back. */
export type JudgmentContext =
  | { kind: "start"; sendBacks: number }
  | { kind: "retry"; reason: string }
  | { kind: "after-reads"; summaries: ReaderSummary[] };

const RULES =
  "You are read-only: start no pane, change no file, commit nothing and post nothing. Hand every read of files, diffs or logs to reader panes through a reads plan, and open a file yourself only to settle a point a summary leaves open.";

const PLAN =
  "End with one JSON object between a line that reads PLAN-JSON and a line that reads END-PLAN-JSON, with exactly one of reads, work or stop. Reads is a list of objects with question and paths; work is a list of objects with role (writer or reader), name, brief, files and after; stop is an object with reason. Then print RESULT: done as the last line.";

/** A reader summary as the brief quotes it: its lines that would read as a plan or result marker are dropped. */
const quoted = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/PLAN-JSON|RESULT\s*:/.test(line))
    .join("\n");

function contextLines(decision: JudgmentContext): string {
  if (decision.kind === "start") {
    return `The writer was sent back ${decision.sendBacks} times on this idea's pull request, so decide the next step: split the work, re-brief the writer, or stop and send the idea to the owner.`;
  }
  if (decision.kind === "retry") {
    return `The tick refused your previous plan, and this is your one retry. The refusal: ${decision.reason}`;
  }
  const blocks = decision.summaries.map(
    (summary) => `${summary.name}:\n${quoted(summary.text)}`,
  );
  return [
    "The reader panes you asked for have answered. Each block below is one reader's summary; decide from them.",
    ...blocks,
  ].join("\n");
}

/** The brief of a judgment pane: what it decides for the idea, its rules, its plan and the context it is started with. */
export function judgmentBrief(
  idea: string,
  issue: number,
  pr: number | undefined,
  decision: JudgmentContext,
): string {
  const who =
    pr === undefined
      ? "no pull request is known to the tick"
      : `pull request #${pr}`;
  return [
    `You are the judgment pane for idea ${idea} (issue #${issue}, ${who}).`,
    RULES,
    PLAN,
    contextLines(decision),
  ].join("\n");
}

/** The brief of a reader pane: one question, the only paths it may read, and where its answer goes. */
export function readerBrief(
  idea: string,
  issue: number,
  read: ReadRequest,
): string {
  return [
    `You answer one question for idea ${idea} (issue #${issue}). Question: ${read.question}`,
    `You may read only these paths: ${read.paths.join(", ")}.`,
    "You change no file and start no pane. Answer in structured bullets, starting with the line Question: and the question's text.",
    "Print your answer between a line that reads SUMMARY-BEGIN and a line that reads SUMMARY-END. Then print RESULT: done as the last line.",
  ].join("\n");
}
