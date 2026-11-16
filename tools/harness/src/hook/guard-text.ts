// Text the role-worktree path check must not read as paths: heredoc bodies and the string literals
// of inline code. Both are judged here, as pure functions; the check in guard-role-delivery.ts
// decides what to do with the result. When in doubt these keep text as code, so a path the shell
// may run is never hidden from the check.

/** A heredoc that is still open: its terminator word, and whether `<<-` strips the terminator's tabs. */
interface Open {
  tag: string;
  dash: boolean;
}

/** The quote the scan is inside: `'`, `"`, `$'` (escapes, as in double quotes), or null outside quotes. */
interface Scan {
  quote: string | null;
}

// A word that makes a body run as code or as a command: a shell, an interpreter, or a program that
// reads commands from its input. A body under one of these is not text, so it is not stripped.
const RUNS_BODY =
  /(?:^|[\s;&|(])(?:bash|sh|zsh|dash|ksh|node|python\d*|perl|ruby|lua|php|deno|bun|tsx|eval|source|exec|ssh|xargs|env|sudo|su|at|crontab|make)(?=$|[\s;&|)])|(?:^|[\s;&|(])\.(?=\s)/m;

// The operator's optional `-`, then the terminator word: quoted, or a run of word characters.
const TAG = /^(-?)[ \t]*(?:(["'])([^"'\n]+)\2|\\?([^\s;&|()<>'"\\]+))/;

// Arithmetic (`((`, `let`, `$[`) shifts with <<, which opens no heredoc.
const ARITHMETIC = /\(\(|\blet\b|\$\[/;

/** The index after the unquoted character at `i`: a backslash takes the character after it too. */
const after = (line: string, i: number): number =>
  line[i] === "\\" ? i + 2 : i + 1;

/** Moves past one character inside quotes; returns the index after it. */
function inQuote(line: string, i: number, scan: Scan): number {
  const c = line[i] as string;
  if (c === "\\" && scan.quote !== "'") {
    return i + 2;
  }
  if (c === (scan.quote === "$'" ? "'" : scan.quote)) {
    scan.quote = null;
  }
  return i + 1;
}

/** Opens a quote at `i` if one starts there; returns the index after it, or -1. */
function openQuote(line: string, i: number, scan: Scan): number {
  const c = line[i];
  if (c === "$" && line[i + 1] === "'") {
    scan.quote = "$'";
    return i + 2;
  }
  if (c === "'" || c === '"') {
    scan.quote = c;
    return i + 1;
  }
  return -1;
}

/** A heredoc operator at `i`, unless it is a here-string, arithmetic or a word glued to the text before. */
function heredocAt(
  line: string,
  i: number,
): { open: Open; end: number } | undefined {
  const before = i === 0 ? " " : (line[i - 1] as string);
  if (
    line[i] !== "<" ||
    line[i + 1] !== "<" ||
    line[i + 2] === "<" ||
    !/[\s;&|(]/.test(before)
  ) {
    return undefined;
  }
  const word = TAG.exec(line.slice(i + 2));
  return word === null
    ? undefined
    : {
        open: { tag: word[3] ?? word[4] ?? "", dash: word[1] === "-" },
        end: i + 2 + word[0].length,
      };
}

/** Scans one line of command text, skipping quotes and comments, and returns the heredocs it opens. */
function scanLine(line: string, scan: Scan): Open[] {
  const opened: Open[] = [];
  const arithmetic = ARITHMETIC.test(line);
  let i = 0;
  while (i < line.length) {
    if (scan.quote !== null) {
      i = inQuote(line, i, scan);
      continue;
    }
    const quoted = openQuote(line, i, scan);
    const heredoc = arithmetic ? undefined : heredocAt(line, i);
    if (quoted >= 0) {
      i = quoted;
    } else if (heredoc !== undefined) {
      opened.push(heredoc.open);
      i = heredoc.end;
    } else if (
      line[i] === "#" &&
      (i === 0 || /[\s;&|()]/.test(line[i - 1] as string))
    ) {
      break;
    } else {
      i = after(line, i);
    }
  }
  return opened;
}

/**
 * The command with each heredoc's body and terminator removed, so the text of a body is never read
 * as a command or a path. The opening line stays, with any redirect or pipe on it. A body is kept,
 * and the command returned whole, when a shell or interpreter in the command text may run it.
 */
export function withoutHeredocBodies(command: string): string {
  if (!command.includes("<<")) {
    return command;
  }
  const scan: Scan = { quote: null };
  const kept: string[] = [];
  let pending: Open[] = [];
  for (const line of command.split("\n")) {
    const head = pending[0];
    if (head !== undefined) {
      // A body line is skipped; its terminator ends the body, and the next pending heredoc begins.
      if ((head.dash ? line.replace(/^\t+/, "") : line) === head.tag) {
        pending = pending.slice(1);
      }
      continue;
    }
    kept.push(line);
    pending = scanLine(line, scan);
  }
  const text = kept.join("\n");
  return RUNS_BODY.test(text) ? command : text;
}

/** Keywords after which a `/` starts a regex literal rather than dividing. */
const REGEX_AFTER = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "void",
  "delete",
  "throw",
  "yield",
  "await",
  "instanceof",
  "new",
]);
/** Punctuation after which a `/` starts a regex literal rather than dividing. */
const REGEX_AFTER_PUNCTUATION = /[(,=:[!&|?{};+\-*%<>~^]/;

/** One token of inline code: where it ends, the last token read, and the string's contents if it is a string. */
interface Token {
  end: number;
  last: string;
  text?: string;
}

/** The index of the slash that closes the regex literal opened at `start`, or the code's length. */
function regexClose(code: string, start: number): number {
  let j = start + 1;
  let inClass = false;
  while (j < code.length) {
    const d = code[j];
    if (d === "\\") {
      j += 2;
      continue;
    }
    if (d === "[") {
      inClass = true;
    } else if (d === "]") {
      inClass = false;
    } else if (d === "/" && !inClass) {
      break;
    }
    j++;
  }
  return j;
}

/** The string literal opened at `i`, with its contents (an escaped character reads as itself). */
function literal(code: string, i: number): Token {
  const quote = code[i] as string;
  let text = "";
  let j = i + 1;
  while (j < code.length && code[j] !== quote) {
    if (code[j] === "\\") {
      text += code[j + 1] ?? "";
      j += 2;
    } else {
      text += code[j];
      j += 1;
    }
  }
  return { end: j + 1, last: quote, text };
}

/** The token at `i`, or null when a line comment runs to the end of the code. */
function tokenAt(code: string, i: number, last: string): Token | null {
  const c = code[i] as string;
  const next = code[i + 1];
  if (c === "/" && next === "/") {
    const end = code.indexOf("\n", i);
    return end < 0 ? null : { end: end + 1, last };
  }
  if (c === "/" && next === "*") {
    const end = code.indexOf("*/", i + 2);
    return end < 0 ? null : { end: end + 2, last };
  }
  if (c === "'" || c === '"' || c === "`") {
    return literal(code, i);
  }
  if (
    c === "/" &&
    (last === "" || REGEX_AFTER_PUNCTUATION.test(last) || REGEX_AFTER.has(last))
  ) {
    return { end: regexClose(code, i) + 1, last: "regex" };
  }
  if (/[\w$]/.test(c)) {
    let end = i;
    while (end < code.length && /[\w$]/.test(code[end] as string)) {
      end++;
    }
    return { end, last: code.slice(i, end) };
  }
  return { end: i + 1, last: /\s/.test(c) ? last : c };
}

/**
 * The string literals in inline code (`node -e`, `python3 -c`), with their contents. A regex literal
 * is skipped, so `/restrict|Pattern/` is code and not a path; a comment is skipped too, since it
 * runs nothing. Only the literals can name a path the code reads or writes.
 */
export function codeStrings(code: string): string[] {
  const found: string[] = [];
  let last = "";
  let i = 0;
  while (i < code.length) {
    const token = tokenAt(code, i, last);
    if (token === null) {
      break;
    }
    if (token.text !== undefined) {
      found.push(token.text);
    }
    last = token.last;
    i = token.end;
  }
  return found;
}
