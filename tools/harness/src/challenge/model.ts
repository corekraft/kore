/** The Challenger gets two rounds on an idea; after that a person decides (plan 11 Step 3). */
export const MAX_ROUNDS = 2;

/** One challenge round as recorded on the issue. */
export interface Round {
  round: number;
  /** The objections the Challenger still held after this round; empty when it approved. */
  objections: string[];
}

const MARKER = /^<!-- harness-challenge idea=(\d{4}) round=(\d+) -->$/;
const NONE = "No open objections.";

/** The first line of a round's comment: how rounds are found again on the issue. */
export const markerFor = (idea: string, round: number): string =>
  `<!-- harness-challenge idea=${idea} round=${round} -->`;

/** The comment that records one round on the idea's issue. */
export function renderRound(
  idea: string,
  round: number,
  objections: readonly string[],
): string {
  const body =
    objections.length === 0
      ? NONE
      : ["Open objections:", "", ...objections.map((o) => `- ${o}`)].join("\n");
  return `${markerFor(idea, round)}\n## Challenge round ${round} of ${MAX_ROUNDS}\n\n${body}\n`;
}

/** The rounds recorded for one idea among an issue's comments, in round order. Only a comment that starts with the marker counts. */
export function parseRounds(
  idea: string,
  comments: readonly string[],
): Round[] {
  const rounds: Round[] = [];
  for (const comment of comments) {
    const lines = comment.replace(/\r/g, "").split("\n");
    const found = MARKER.exec((lines[0] ?? "").trim());
    if (found?.[1] !== idea || found[2] === undefined) {
      continue;
    }
    rounds.push({
      round: Number(found[2]),
      objections: lines
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).trim())
        .filter((line) => line !== ""),
    });
  }
  return rounds.sort((a, b) => a.round - b.round);
}

/** Objections from standard input, one per line; a leading bullet is dropped and blank lines are skipped. */
export function parseObjections(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s+/, "").trim())
    .filter((line) => line !== "");
}
