// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md

/** The last character before `index` that is not whitespace, as its index; -1 when there is none. */
function previousNonSpace(text: string, index: number): number {
  for (let i = index - 1; i >= 0; i--) {
    if (!/\s/.test(text.charAt(i))) {
      return i;
    }
  }
  return -1;
}

/**
 * The text with one JSON-compatible member removed: the span [start, end)
 * and the comma that separates it from its neighbour. A member that stands
 * alone on its line takes the whole line with it. Every other byte is kept, so
 * a retirement changes only what it names.
 */
export function removeMember(text: string, start: number, end: number): string {
  const trailingComma = /^[ \t]*,[ \t]*/.exec(text.slice(end));
  const hasTrailingComma = trailingComma !== null;
  const to = hasTrailingComma ? end + trailingComma[0].length : end;
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", to);
  const lineEnd = newline === -1 ? text.length : newline;
  const alone =
    text.slice(lineStart, start).trim() === "" &&
    text.slice(to, lineEnd).trim() === "";
  const comma = previousNonSpace(text, start);
  // The last member has no comma of its own, so the comma before it goes.
  const takesPrecedingComma = !hasTrailingComma && text.charAt(comma) === ",";
  if (alone) {
    const cut = newline === -1 ? text.length : newline + 1;
    if (takesPrecedingComma) {
      // The comma ends an earlier line, so it goes with the member's line.
      return (
        text.slice(0, comma) +
        text.slice(comma + 1, lineStart) +
        text.slice(cut)
      );
    }
    return text.slice(0, lineStart) + text.slice(cut);
  }
  if (takesPrecedingComma) {
    return text.slice(0, comma) + text.slice(end);
  }
  return text.slice(0, start) + text.slice(to);
}
