/** The lines that fence a reader pane's summary, so the tick takes it from the pane's other output. */
export const SUMMARY_BEGIN = "SUMMARY-BEGIN";
export const SUMMARY_END = "SUMMARY-END";

/** The most characters of one reader summary a judgment pane's brief carries; a placeholder. */
export const SUMMARY_MAX = 2000;

const BEGIN_LINE = /^[ \t]*(?:[●⏺][ \t]+)?SUMMARY-BEGIN[ \t\r]*$/;
const END_LINE = /^[ \t]*(?:[●⏺][ \t]+)?SUMMARY-END[ \t\r]*$/;
const RESULT_LINE = /RESULT[ \t]*:/;

const NONE = `The reader printed no summary between ${SUMMARY_BEGIN} and ${SUMMARY_END}.`;

/**
 * The text between the last pair of summary lines, with any RESULT line dropped and capped at
 * SUMMARY_MAX characters. A pane that printed no summary says so, so the judgment still sees it.
 */
export function readSummary(pane: string): string {
  const lines = pane.split("\n");
  let found: string[] | undefined;
  let start: number | undefined;
  lines.forEach((line, at) => {
    if (BEGIN_LINE.test(line)) {
      start = at;
    } else if (END_LINE.test(line) && start !== undefined) {
      found = lines.slice(start + 1, at);
      start = undefined;
    }
  });
  if (found === undefined) {
    return NONE;
  }
  const text = found
    .filter((line) => !RESULT_LINE.test(line))
    .join("\n")
    .trim();
  if (text === "") {
    return NONE;
  }
  return text.length > SUMMARY_MAX
    ? `${text.slice(0, SUMMARY_MAX)}\n(cut at ${SUMMARY_MAX} characters)`
    : text;
}
