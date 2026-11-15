export const MARKER_HEADING = "## Retrospective marker";

const SECTION = new RegExp(
  `(^${MARKER_HEADING}\\n+Last retrospective: )[^\\n]*`,
  "m",
);

/**
 * The plan text with its tool-kept marker section holding `stamp`. Earlier
 * `Last retrospective:` lines stay: they date the retros written up above.
 */
export function withMarker(text: string, stamp: string): string {
  if (SECTION.test(text)) {
    return text.replace(SECTION, `$1${stamp}`);
  }
  const body = text.endsWith("\n") ? text : `${text}\n`;
  return `${body}\n${MARKER_HEADING}\n\nLast retrospective: ${stamp}\n`;
}
