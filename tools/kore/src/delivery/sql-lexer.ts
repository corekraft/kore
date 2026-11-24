// Docs: docs/decisions/0171-app-migrations-run-before-the-rollout-expand-first-and-contract-after-the-soak.md
// A small lexer that splits a migration file into statements. It fails closed: anything it cannot
// read exactly (an unterminated literal, a dollar-quoted body, an E-string) is an error, and the
// file then classifies as a contract.

export type SplitResult = { statements: string[] } | { error: string };

/** What one read of the text yields: the text it keeps and where to go next, or a statement end. */
type Piece = { error: string } | { text: string; next: number; ends: boolean };

// A dollar quote opens with $tag$ or $$, the tag an identifier or empty.
const DOLLAR_QUOTE = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

/**
 * Splits SQL on top-level semicolons. Comments are removed, string literals become '?' and quoted
 * identifiers "?", so keywords inside them can never be read as keywords. Statements are trimmed,
 * and empty ones are dropped.
 */
export function splitStatements(text: string): SplitResult {
  const statements: string[] = [];
  let current = "";
  let index = 0;
  while (index < text.length) {
    const piece = readPiece(text, index);
    if ("error" in piece) {
      return piece;
    }
    if (piece.ends) {
      pushStatement(statements, current);
      current = "";
    } else {
      current += piece.text;
    }
    index = piece.next;
  }
  pushStatement(statements, current);
  return { statements };
}

function readPiece(text: string, index: number): Piece {
  return (
    readComment(text, index) ??
    readLiteral(text, index) ??
    readDollarQuote(text, index) ?? {
      text: text[index] ?? "",
      next: index + 1,
      ends: text[index] === ";",
    }
  );
}

/** A line or block comment, which becomes a space; undefined when the text is not at a comment. */
function readComment(text: string, index: number): Piece | undefined {
  if (text[index] === "-" && text[index + 1] === "-") {
    const end = text.indexOf("\n", index);
    return { text: " ", next: end === -1 ? text.length : end, ends: false };
  }
  if (text[index] === "/" && text[index + 1] === "*") {
    const end = blockCommentEnd(text, index);
    return end === undefined
      ? { error: "an unterminated block comment" }
      : { text: " ", next: end, ends: false };
  }
  return undefined;
}

/** A string or quoted identifier, masked to a placeholder; undefined when the text is not at one. */
function readLiteral(text: string, index: number): Piece | undefined {
  if (text[index] === "'") {
    if (isEscapePrefix(text, index)) {
      return {
        error: "an E'' escape string, which the classifier does not read",
      };
    }
    return maskedLiteral(text, index, "'", "'?'");
  }
  if (text[index] === '"') {
    return maskedLiteral(text, index, '"', '"?"');
  }
  return undefined;
}

function maskedLiteral(
  text: string,
  index: number,
  quote: "'" | '"',
  mask: string,
): Piece {
  const end = closingQuote(text, index, quote);
  if (end === undefined) {
    return {
      error:
        quote === "'"
          ? "an unterminated string literal"
          : "an unterminated quoted identifier",
    };
  }
  return { text: mask, next: end + 1, ends: false };
}

/** A dollar quote, which is an error because its body is not read; undefined for ordinary text. */
function readDollarQuote(text: string, index: number): Piece | undefined {
  if (text[index] !== "$" || isIdentifierChar(text[index - 1])) {
    return undefined;
  }
  DOLLAR_QUOTE.lastIndex = index;
  return DOLLAR_QUOTE.test(text)
    ? { error: "a dollar-quoted body, which the classifier does not read" }
    : undefined;
}

function pushStatement(statements: string[], text: string): void {
  const trimmed = text.trim();
  if (trimmed !== "") {
    statements.push(trimmed);
  }
}

/** The index just past the block comment that opens at start, counting nesting as PostgreSQL does. */
function blockCommentEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let index = start;
  while (index < text.length) {
    if (text[index] === "/" && text[index + 1] === "*") {
      depth++;
      index += 2;
    } else if (text[index] === "*" && text[index + 1] === "/") {
      depth--;
      index += 2;
      if (depth === 0) {
        return index;
      }
    } else {
      index++;
    }
  }
  return undefined;
}

/** The index of the quote that closes the literal opened at start; a doubled quote is an escape. */
function closingQuote(
  text: string,
  start: number,
  quote: "'" | '"',
): number | undefined {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === quote) {
      if (text[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index;
    }
    index++;
  }
  return undefined;
}

/** True for E'...' (or e'...'), where a backslash escapes the next character and the lexer stops. */
function isEscapePrefix(text: string, quoteIndex: number): boolean {
  const prefix = text[quoteIndex - 1];
  return (
    (prefix === "E" || prefix === "e") &&
    !isIdentifierChar(text[quoteIndex - 2])
  );
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
}
