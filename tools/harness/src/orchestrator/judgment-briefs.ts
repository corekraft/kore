import type { ReadRequest, WorkPiece } from "./judgment-check.js";

/** One reader's summary, named by the session that wrote it, for a judgment session's next brief. */
export interface ReaderSummary {
  name: string;
  text: string;
}

/** What a judgment session is started to decide: its first decision, a retry after a refusal, or the summaries its reads brought back. */
export type JudgmentContext =
  | { kind: "start"; sendBacks: number }
  | { kind: "retry"; reason: string }
  | { kind: "after-reads"; summaries: ReaderSummary[] };

const RULES =
  "You are read-only: start no session, change no file, commit nothing and post nothing. Hand every read of files, diffs or logs to reader sessions through a reads plan, and open a file yourself only to settle a point a summary leaves open.";

/** The plan: the object goes to session report on its standard input, which stores it as the report's plan. */
const HC_PLAN = `End with one JSON object that is your plan, with exactly one of reads, work or stop. Reads is a list of objects with question and paths; work is a list of objects with role (writer or reader), name, brief, files and after; stop is an object with reason. Then, as your last action, run \`node skills/bin/harness.mjs session report --outcome done --summary "plan written" --plan - <<'EOF'\`, with that object on the lines after it, then a line that reads EOF.`;

/** The answer: the answer goes to session report on its standard input, which stores it as the report's summary. */
const HC_ANSWER = `Then, as your last action, run \`node skills/bin/harness.mjs session report --outcome done --summary - <<'EOF'\`, with your answer on the lines after it, then a line that reads EOF. Use --outcome blocked only when you cannot answer.`;

function contextLines(decision: JudgmentContext): string {
  if (decision.kind === "start") {
    return `The writer was sent back ${decision.sendBacks} times on this idea's pull request, so decide the next step: split the work, re-brief the writer, or stop and send the idea to the owner.`;
  }
  if (decision.kind === "retry") {
    return `The tick refused your previous plan, and this is your one retry. The refusal: ${decision.reason}`;
  }
  const blocks = decision.summaries.map(
    (summary) => `${summary.name}:\n${summary.text}`,
  );
  return [
    "The reader sessions you asked for have answered. Each block below is one reader's summary; decide from them.",
    ...blocks,
  ].join("\n");
}

/** The brief of a judgment session: what it decides for the idea, its rules, its plan and the context it is started with. */
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
    `You are the judgment session for idea ${idea} (issue #${issue}, ${who}).`,
    RULES,
    HC_PLAN,
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
    `A judgment session re-briefed you after this pull request was sent back three times. Its brief is the work to do now: ${piece.brief}`,
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
): string {
  return piece.role === "writer"
    ? rebriefBrief(idea, issue, { brief: piece.brief, files: piece.files })
    : readerBrief(idea, issue, { question: piece.brief, paths: piece.files });
}

/** The brief of a reader session: one question, the only paths it may read, and where its answer goes. */
export function readerBrief(
  idea: string,
  issue: number,
  read: ReadRequest,
): string {
  return [
    `You answer one question for idea ${idea} (issue #${issue}). Question: ${read.question}`,
    `You may read only these paths: ${read.paths.join(", ")}.`,
    "You change no file and start no session. Answer in structured bullets, starting with the line Question: and the question's text.",
    HC_ANSWER,
  ].join("\n");
}
