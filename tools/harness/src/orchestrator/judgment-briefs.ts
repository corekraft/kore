import type { ReadRequest, WorkPiece } from "./judgment-check.js";

/** The backend a brief is written for: a herdr pane answers in marker lines, an hc session through its report. */
export type BriefBackend = "herdr" | "hc";

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

/** The hc plan: the object goes to a file that session report carries as the report's plan. */
const HC_PLAN =
  'End with one JSON object that is your plan, with exactly one of reads, work or stop. Reads is a list of objects with question and paths; work is a list of objects with role (writer or reader), name, brief, files and after; stop is an object with reason. Write that object to the file .kore/report/<your session name>.plan.json, then run `harness session report --outcome done --summary "plan written" --plan .kore/report/<your session name>.plan.json` as your last action.';

/** The hc answer: the reader writes it to a file that session report carries as its summary. */
const HC_ANSWER =
  "Write your answer to the file .kore/report/<your session name>.md, then run `harness session report --outcome done --file .kore/report/<your session name>.md` as your last action.";

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
  backend: BriefBackend = "herdr",
): string {
  const who =
    pr === undefined
      ? "no pull request is known to the tick"
      : `pull request #${pr}`;
  return [
    `You are the judgment pane for idea ${idea} (issue #${issue}, ${who}).`,
    RULES,
    backend === "hc" ? HC_PLAN : PLAN,
    contextLines(decision),
  ].join("\n");
}

/**
 * The brief of a writer a judgment re-brief starts: the writer's own rules (one pull request that says
 * Refs, and no merge), then the judgment's brief as the work to do now, and the paths it may change.
 */
export function rebriefBrief(
  idea: string,
  issue: number,
  piece: { brief: string; files: readonly string[] },
): string {
  return [
    `Deliver idea ${idea} (issue #${issue}) as one pull request that says \`Refs #${issue}\`. Do not merge.`,
    `A judgment pane re-briefed you after this pull request was sent back three times. Its brief is the work to do now: ${piece.brief}`,
    piece.files.length === 0
      ? ""
      : `Change only these paths: ${piece.files.join(", ")}.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * The brief of a work piece the tick starts: a writer is re-briefed on the idea's pull request with the
 * piece's work, and a reader answers the piece's brief as its question over the piece's files.
 */
export function pieceBrief(
  idea: string,
  issue: number,
  piece: WorkPiece,
  backend: BriefBackend = "herdr",
): string {
  return piece.role === "writer"
    ? rebriefBrief(idea, issue, { brief: piece.brief, files: piece.files })
    : readerBrief(
        idea,
        issue,
        { question: piece.brief, paths: piece.files },
        backend,
      );
}

/** The brief of a reader pane: one question, the only paths it may read, and where its answer goes. */
export function readerBrief(
  idea: string,
  issue: number,
  read: ReadRequest,
  backend: BriefBackend = "herdr",
): string {
  return [
    `You answer one question for idea ${idea} (issue #${issue}). Question: ${read.question}`,
    `You may read only these paths: ${read.paths.join(", ")}.`,
    "You change no file and start no pane. Answer in structured bullets, starting with the line Question: and the question's text.",
    backend === "hc"
      ? HC_ANSWER
      : "Print your answer between a line that reads SUMMARY-BEGIN and a line that reads SUMMARY-END. Then print RESULT: done as the last line.",
  ].join("\n");
}
