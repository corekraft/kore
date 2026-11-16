// Text the role-worktree path check must not read as paths: heredoc bodies and the string literals
// of inline code. Both are judged here, as pure functions; the check in guard-role-worktree.ts
// decides what to do with the result. These fail closed (ADR 0080): text is hidden from the check
// only in a shape that is allowed by name, and everything else stays code the check reads.
import { splitSegments } from "./guard-shell.js";

/**
 * A heredoc that is still open: its terminator word, whether `<<-` strips the terminator's tabs,
 * whether the shell expands its body (an unquoted terminator), and whether the terminator word is
 * one this scan reads the way the shell does (a word part-way quoted, as in `E"O"F`, is not).
 */
interface Open {
  tag: string;
  dash: boolean;
  expands: boolean;
  plain: boolean;
}

/** The quote the scan is inside: `'`, `"`, `$'` (escapes, as in double quotes), or null outside quotes. */
interface Scan {
  quote: string | null;
}

// The operator's optional `-`, then the terminator word: quoted, or a run of word characters after
// an optional backslash (which quotes it too).
const TAG = /^(-?)[ \t]*(?:(["'])([^"'\n]+)\2|(\\?)([^\s;&|()<>'"\\]+))/;

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
  if (word === null) {
    return undefined;
  }
  const end = i + 2 + word[0].length;
  return {
    open: {
      tag: word[3] ?? word[5] ?? "",
      dash: word[1] === "-",
      expands: word[2] === undefined && word[4] === "",
      plain: end >= line.length || /[\s;&|()<>]/.test(line[end] as string),
    },
    end,
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

/** A substitution or process substitution, which runs a command, or any parenthesis. */
const SUBSTITUTION = /\$\(|`|[()]/;

/**
 * Whether the command text left after the bodies are taken out is one `cat` or `tee` and nothing
 * else: a single segment whose first word is exactly `cat` or `tee`, with no `;`, `&&`, `||`, `|`,
 * `&` or newline joining a second command, no substitution or parenthesis (so no `$(`, backtick,
 * `<(` or `>(`), and no line that continues onto the next. A redirect target on the line stays in
 * the text, so the path check still reads it.
 */
function onlyWrites(text: string): boolean {
  const segments = splitSegments(text);
  const first = segments[0]?.[0];
  return (
    segments.length === 1 &&
    (first === "cat" || first === "tee") &&
    !SUBSTITUTION.test(text) &&
    !/\\$/m.test(text)
  );
}

/**
 * The command with each heredoc's body and terminator removed, so the text of a body is never read
 * as a command or a path. The opening line stays, with any redirect on it. This fails closed: a body
 * is removed only when the whole command is one `cat` or `tee` that writes a file (see `onlyWrites`),
 * every terminator reads as the shell reads it, and no unquoted terminator lets the body run a
 * substitution. In any other shape the command is returned whole and the body stays code: a
 * second command, a shell or interpreter, `source`, `exec`, `eval`, `xargs`, a path run as a command,
 * or a file written and then used may all run what the body says.
 */
export function withoutHeredocBodies(command: string): string {
  if (!command.includes("<<")) {
    return command;
  }
  const scan: Scan = { quote: null };
  const kept: string[] = [];
  let pending: Open[] = [];
  let text = true;
  for (const line of command.split("\n")) {
    const head = pending[0];
    if (head !== undefined) {
      // A body line is skipped; its terminator ends the body, and the next pending heredoc begins.
      if ((head.dash ? line.replace(/^\t+/, "") : line) === head.tag) {
        pending = pending.slice(1);
      } else if (head.expands && SUBSTITUTION.test(line)) {
        text = false;
      }
      continue;
    }
    kept.push(line);
    pending = scanLine(line, scan);
    text &&= pending.every((open) => open.plain);
  }
  const rest = kept.join("\n");
  return text && onlyWrites(rest) ? rest : command;
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
/**
 * Punctuation after which a `/` starts a regex literal rather than dividing. Not `+` or `-`: after
 * `a++` a slash divides. Not `*`: after it the slash may end a comment. Read as a regex, either
 * would hide the code up to the next slash.
 */
const REGEX_AFTER_PUNCTUATION = /[(,=:[!&|?{};%<>~^]/;

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

/**
 * The token at `i`. A comment is not skipped, so code hidden in what looks like one (Python's `//`
 * divides) is still read; a `//` or `/*` is not a regex, and a word after a `.` is a property name,
 * not a keyword, so a slash after it divides.
 */
function tokenAt(code: string, i: number, last: string): Token {
  const c = code[i] as string;
  if (c === "'" || c === '"' || c === "`") {
    return literal(code, i);
  }
  if (
    c === "/" &&
    !/[/*]/.test(code[i + 1] ?? "") &&
    (last === "" || REGEX_AFTER_PUNCTUATION.test(last) || REGEX_AFTER.has(last))
  ) {
    return { end: regexClose(code, i) + 1, last: "regex" };
  }
  if (/[\w$]/.test(c)) {
    let end = i;
    while (end < code.length && /[\w$]/.test(code[end] as string)) {
      end++;
    }
    return { end, last: code[i - 1] === "." ? "." : code.slice(i, end) };
  }
  return { end: i + 1, last: /\s/.test(c) ? last : c };
}

/**
 * The string literals in JavaScript inline code (`node -e`), with their contents. Only a regex
 * literal is skipped, so `/restrict|Pattern/` is code and not a path; every string literal stays a
 * path candidate, and a comment is read like code. Python has no regex literal, so `python3 -c` is
 * not read through this at all.
 */
export function codeStrings(code: string): string[] {
  const found: string[] = [];
  let last = "";
  let i = 0;
  while (i < code.length) {
    const token = tokenAt(code, i, last);
    if (token.text !== undefined) {
      found.push(token.text);
    }
    last = token.last;
    i = token.end;
  }
  return found;
}
