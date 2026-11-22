// A heredoc's body is data only for the one command that carries it: a session report or send. Every other
// heredoc is left whole, so its body is read as shell and refused when it holds a write. The guard models no
// bash: one strict line shape is allowed, and anything else strips nothing.

/**
 * The only first line whose heredoc body is dropped: `node skills/bin/harness.mjs session report|send`, plain
 * word arguments (no quotes, `$`, backticks, operators or redirections) and a quoted `<<'TAG'` opener at the end.
 */
const ALLOWED_OPENER =
  /^node skills\/bin\/harness\.mjs session (?:report|send)(?: [A-Za-z0-9_./:=@+,-]+)* <<'([A-Za-z_][A-Za-z0-9_]*)'$/;

/**
 * The shell a command runs, with the body of an allowed session report or send heredoc removed. A command whose
 * first line is anything else is returned whole. The lines after the terminator stay, so a command placed after it
 * is still checked (shellText cuts them).
 */
export function shellOutsideBodies(command: string): string {
  const lines = command.split("\n");
  const tag = ALLOWED_OPENER.exec(lines[0] as string)?.[1];
  if (tag === undefined) {
    return command;
  }
  const end = lines.indexOf(tag, 1);
  return [lines[0], ...(end === -1 ? [] : lines.slice(end + 1))].join("\n");
}
