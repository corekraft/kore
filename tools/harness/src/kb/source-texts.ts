// The string literals of a TypeScript source file, each with the line it starts on: the text a harness command check reads in source.
// Docs: infra/plans/17-harness-help-guide.md#step-1-help-guide

/** One string literal of a source file: the 1-based line it starts on, and its text with its escapes read. */
export interface SourceText {
  readonly line: number;
  readonly text: string;
}

const ESCAPE = /\\([\s\S])/g;

/** The character an escape stands for; `\n` and `\t` become a space, so a word never runs into the next. */
function unescape(raw: string): string {
  return raw.replace(ESCAPE, (_match, char: string) =>
    char === "n" || char === "t" ? " " : char,
  );
}

/** The index of the quote that closes the literal opened at `open`; a quote that is never closed ends at its line. */
function closeAt(source: string, open: number): number {
  const quote = source[open];
  let at = open + 1;
  while (at < source.length) {
    const char = source[at];
    if (char === "\\") {
      at += 2;
    } else if (char === quote || (char === "\n" && quote !== "`")) {
      return at;
    } else {
      at++;
    }
  }
  return source.length;
}

const newlines = (text: string): number => text.split("\n").length - 1;

/** The string literals of a source file, in order; comments are skipped, so a harness command in one is never read. */
export function sourceTexts(source: string): SourceText[] {
  const texts: SourceText[] = [];
  let line = 1;
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (source.startsWith("//", at)) {
      const end = source.indexOf("\n", at);
      at = end === -1 ? source.length : end;
    } else if (source.startsWith("/*", at)) {
      const end = source.indexOf("*/", at + 2);
      const stop = end === -1 ? source.length : end + 2;
      line += newlines(source.slice(at, stop));
      at = stop;
    } else if (char === "'" || char === '"' || char === "`") {
      const close = closeAt(source, at);
      const raw = source.slice(at + 1, close);
      texts.push({ line, text: unescape(raw) });
      line += newlines(raw);
      at = source[close] === char ? close + 1 : close;
    } else {
      if (char === "\n") {
        line++;
      }
      at++;
    }
  }
  return texts;
}
