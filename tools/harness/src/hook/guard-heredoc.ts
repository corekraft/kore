// A heredoc's body is data when its delimiter is quoted. The guards read the shell
// around it, so a body that holds backticks or `$(` text is not refused as a command.

// A heredoc opener: `<<WORD` or `<<-WORD`; a quoted delimiter makes the body literal.
const HEREDOC_OPENER = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/;

/**
 * The shell a command runs, with each quoted heredoc's body removed. An unquoted body expands, so it stays.
 * The lines after a body stay too, so a command placed after the terminator is still checked (shellText cuts them).
 */
export function shellOutsideBodies(command: string): string {
  const kept: string[] = [];
  let open:
    { delimiter: string; indented: boolean; quoted: boolean } | undefined;
  for (const line of command.split("\n")) {
    if (open === undefined) {
      kept.push(line);
      const match = HEREDOC_OPENER.exec(line);
      if (match !== null) {
        open = {
          delimiter: match[3] as string,
          indented: match[1] === "-",
          quoted: match[2] !== "",
        };
      }
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
