// A heredoc's body is data when its delimiter is quoted. The guards read the shell
// around it, so a body that holds backticks or `$(` text is not refused as a command.

// A heredoc opener at one position: `<<WORD` or `<<-WORD`; a quoted delimiter makes the body literal.
const HEREDOC_OPENER = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/y;

interface Open {
  delimiter: string;
  indented: boolean;
  quoted: boolean;
}

/** What the scan carries from one line to the next: a quoted string or a parenthesis can span lines. */
interface Scan {
  single: boolean;
  double: boolean;
  depth: number;
  /** Set once the shell reads `${`, `$[` or `[[`: it is not modelled, so no later opener is trusted. */
  opaque: boolean;
}

/** True where the shell reads `${`, `$[` or `[[`, whose insides this scan does not model. */
function startsUnmodelled(line: string, i: number): boolean {
  return (
    (line[i] === "$" && "{[".includes(line[i + 1] ?? "")) ||
    line.startsWith("[[", i)
  );
}

/** True where a # starts a comment: at a word start, which a $# or a mid-word # is not. */
function startsComment(line: string, i: number): boolean {
  return line[i] === "#" && /[\s;&|(]/.test(line[i - 1] ?? " ");
}

/** The opener at position i, when the shell would read the <<WORD there as a heredoc. */
function openerAt(line: string, i: number): Open | undefined {
  HEREDOC_OPENER.lastIndex = i;
  const match = HEREDOC_OPENER.exec(line);
  if (match === null) {
    return undefined;
  }
  return {
    delimiter: match[3] as string,
    indented: match[1] === "-",
    quoted: match[2] !== "",
  };
}

/**
 * The opener a line holds, if the shell reads one: outside quotes, comments and parentheses (which cover
 * arithmetic and subshells), and not a here-string. A <<WORD that the shell reads as text drops no body.
 */
function openerIn(line: string, scan: Scan): Open | undefined {
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] as string;
    if (scan.single) {
      scan.single = char !== "'";
    } else if (char === "\\") {
      i += 1;
    } else if (startsUnmodelled(line, i)) {
      scan.opaque = true;
    } else if (scan.double) {
      scan.double = char !== '"';
    } else if (char === "'" || char === '"') {
      scan.single = char === "'";
      scan.double = char === '"';
    } else if (char === "(" || char === ")") {
      scan.depth = Math.max(0, scan.depth + (char === "(" ? 1 : -1));
    } else if (startsComment(line, i)) {
      return undefined;
    } else if (line.startsWith("<<<", i)) {
      i += 2;
    } else if (line.startsWith("<<", i) && scan.depth === 0 && !scan.opaque) {
      const open = openerAt(line, i);
      if (open !== undefined) {
        return open;
      }
      i += 1;
    }
  }
  return undefined;
}

/**
 * The shell a command runs, with each quoted heredoc's body removed. An unquoted body expands, so it stays.
 * The lines after a body stay too, so a command placed after the terminator is still checked (shellText cuts them).
 * Only an opener the shell itself reads counts: one inside a string, a comment or arithmetic hides nothing. A command
 * with `${`, `$[` or `[[` is not modelled further, so it fails closed: every later line is checked.
 */
export function shellOutsideBodies(command: string): string {
  const kept: string[] = [];
  const scan: Scan = { single: false, double: false, depth: 0, opaque: false };
  let open: Open | undefined;
  for (const line of command.split("\n")) {
    if (open === undefined) {
      kept.push(line);
      open = openerIn(line, scan);
      continue;
    }
    const ends = open.indented
      ? line.trim() === open.delimiter
      : line === open.delimiter;
    if (!open.quoted) {
      kept.push(line);
    }
    if (ends) {
      open = undefined;
    }
  }
  return kept.join("\n");
}
