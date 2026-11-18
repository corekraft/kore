// The lines the lint's max-lines rule counts (oxlint with skipBlankLines and skipComments): a line
// is skipped when it is blank or holds only comment text. A line of code with a trailing comment
// counts, and so does a line inside a string or a template literal. The scan reads one line at a
// time and carries an open block comment or template literal across lines. A regex literal is
// read as one token, so a quote inside it opens no string.

/** Words after which a `/` starts a regex literal rather than dividing a value. */
const REGEX_AFTER_WORD = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
]);

/** The scan's position between lines: what is still open, and the last code token read. */
interface State {
  inBlock: boolean;
  inTemplate: boolean;
  /** A word, a punctuator character, or `value` after a literal; empty at the start of the file. */
  last: string;
}

const isWord = (token: string): boolean => /^[\w$]/.test(token);

/** Counts the lines of a source file that hold code, as the lint's max-lines rule does. */
export function codeLineCount(source: string): number {
  const state: State = { inBlock: false, inTemplate: false, last: "" };
  let count = 0;
  for (const line of source.split("\n")) {
    // A whitespace-only line is skipped even inside a template literal, as the lint skips it.
    if (line.trim() !== "" && readLine(line, state)) {
      count += 1;
    }
  }
  return count;
}

/** True when the line holds code outside its comments; the state carries what stays open. */
function readLine(line: string, state: State): boolean {
  let code = false;
  let at = 0;
  while (at < line.length) {
    if (state.inBlock) {
      const close = line.indexOf("*/", at);
      if (close === -1) {
        return code;
      }
      state.inBlock = false;
      at = close + 2;
    } else if (state.inTemplate) {
      code = true;
      at = skipTemplate(line, at, state);
    } else {
      const ch = line.charAt(at);
      const next = line.charAt(at + 1);
      if (/\s/.test(ch)) {
        at += 1;
      } else if (ch === "/" && next === "/") {
        return code;
      } else if (ch === "/" && next === "*") {
        state.inBlock = true;
        at += 2;
      } else {
        code = true;
        at = readToken(line, at, state);
      }
    }
  }
  return code;
}

/** Reads one code token from `at` and returns the position after it; the state records the last token. */
function readToken(line: string, at: number, state: State): number {
  const ch = line.charAt(at);
  if (ch === '"' || ch === "'") {
    state.last = "value";
    return skipQuoted(line, at, ch);
  }
  if (ch === "`") {
    state.inTemplate = true;
    state.last = "value";
    return at + 1;
  }
  if (ch === "/" && regexStarts(state.last)) {
    state.last = "value";
    return skipRegex(line, at);
  }
  if (isWord(ch)) {
    let end = at;
    while (end < line.length && isWord(line.charAt(end))) {
      end += 1;
    }
    state.last = line.slice(at, end);
    return end;
  }
  state.last = ch;
  return at + 1;
}

function regexStarts(last: string): boolean {
  if (last === "") {
    return true;
  }
  if (isWord(last)) {
    return REGEX_AFTER_WORD.has(last);
  }
  return !")]}".includes(last);
}

/** The position after a quoted string that ends on this line, or the line's end when it does not. */
function skipQuoted(line: string, at: number, quote: string): number {
  let j = at + 1;
  while (j < line.length) {
    const c = line.charAt(j);
    if (c === "\\") {
      j += 2;
    } else if (c === quote) {
      return j + 1;
    } else {
      j += 1;
    }
  }
  return line.length;
}

/** The position after a regex literal's closing slash and before its flags; a `/` inside a class does not close it. */
function skipRegex(line: string, at: number): number {
  let inClass = false;
  let j = at + 1;
  while (j < line.length) {
    const c = line.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (inClass) {
      inClass = c !== "]";
    } else if (c === "[") {
      inClass = true;
    } else if (c === "/") {
      return j + 1;
    }
    j += 1;
  }
  return line.length;
}

/** The position after a template text run on this line; a closing backtick ends the template. */
function skipTemplate(line: string, at: number, state: State): number {
  let j = at;
  while (j < line.length) {
    const c = line.charAt(j);
    if (c === "\\") {
      j += 2;
    } else if (c === "`") {
      state.inTemplate = false;
      return j + 1;
    } else {
      j += 1;
    }
  }
  return line.length;
}
