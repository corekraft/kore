/** A marker is a line of its own: after indent or Claude's bullet, nothing but the marker. */
const NONE = /^[ \t]*(?:[●⏺][ \t]+)?VERDICT: none[ \t\r]*$/gm;
const FINDINGS = /^[ \t]*(?:[●⏺][ \t]+)?VERDICT: findings[ \t\r]*$/gm;
const END = /^[ \t]*(?:[●⏺][ \t]+)?END VERDICT[ \t\r]*$/m;

/** Where the last match of a marker line starts and ends in the text, or undefined. */
function lastMarker(
  text: string,
  marker: RegExp,
): { start: number; end: number } | undefined {
  const last = [...text.matchAll(marker)].at(-1);
  return last === undefined
    ? undefined
    : { start: last.index, end: last.index + last[0].length };
}

/**
 * The findings of the Reviewer's verdict in its pane text: `VERDICT: none` is a clean
 * review, and `VERDICT: findings` then one finding per line up to `END VERDICT` is the
 * list. Only a line that is nothing but the marker counts, so the brief's own description
 * of the form never does. The last verdict wins; undefined when there is no complete one.
 */
export function readVerdict(text: string): string[] | undefined {
  const none = lastMarker(text, NONE);
  const found = lastMarker(text, FINDINGS);
  if (none !== undefined && (found === undefined || none.start > found.start)) {
    return [];
  }
  if (found === undefined) {
    return undefined;
  }
  const rest = text.slice(found.end);
  const end = END.exec(rest);
  if (end === null) {
    return undefined;
  }
  const findings = joinWrapped(
    rest
      .slice(0, end.index)
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  return findings.length === 0 ? undefined : findings;
}

/** A finding has four fields, `file:line | rule | what is wrong | smallest fix`, so three separators. */
const FIELDS = 4;

/**
 * Rejoins the rows a narrow pane cut from one finding: a row continues the finding before it
 * while that finding still lacks a field, so a cut inside a word, a path or a field comes back
 * as it was written. A finding with fewer fields than that takes the next row too.
 */
function joinWrapped(rows: string[]): string[] {
  const findings: string[] = [];
  for (const row of rows) {
    const last = findings.at(-1);
    if (last !== undefined && last.split("|").length < FIELDS) {
      findings[findings.length - 1] = last + row;
    } else {
      findings.push(row);
    }
  }
  return findings;
}
