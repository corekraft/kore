// Bash rules: split a command into segments and check each one. A block in any
// segment wins; otherwise the first warning stands. The per-segment rules live in
// guard-bash-segment.ts.
import { checkBashSegment } from "./guard-bash-segment.js";
import { bareGlob } from "./guard-bare-glob.js";
import { unquotedGlob } from "./guard-unquoted-glob.js";
import {
  execGlobQualifier,
  rawWords,
  scriptOf,
  shellText,
  splitSegments,
} from "./guard-shell.js";
import {
  applyMode,
  block,
  warn,
  weigh,
  type Finding,
  type GuardContext,
  type Verdict,
} from "./guard-verdict.js";

// A zsh glob qualifier such as `*(e:'cmd':)` runs code in a word the segment checks read as
// an argument, so it blocks for every session, bounded or not (#335). It shares the
// `unquoted-glob` rule: both are a glob zsh expands in a way the author did not intend.
// A script given to `bash -c` or `eval` is scanned too, since its quotes hide the word.
function globQualifier(command: string): Finding {
  const text = shellText(command);
  const qualifier =
    execGlobQualifier(text) ??
    splitSegments(text)
      .map(scriptOf)
      .map((script) =>
        script === undefined ? undefined : execGlobQualifier(script),
      )
      .find((found) => found !== undefined);
  return qualifier === undefined
    ? null
    : block(
        "unquoted-glob",
        `${qualifier} is a zsh glob qualifier that runs code (e:'...' or +function) when the word expands. ` +
          "Instead, list the files with a plain glob or `find`, and run the command on the result in a separate step.",
      );
}

// zsh pitfall beyond --include/--exclude, in audit mode (warn): a word starting
// with = is expanded as a command lookup ("== not found"). The bare-glob rule
// lives in guard-bare-glob.ts.
function equalsWord(command: string): Finding {
  const text = shellText(command).replace(/\$?\(\([^)]*\)\)/g, "");
  const equals = text.includes("[[")
    ? undefined
    : rawWords(text).find((w) => w.equals);
  return equals
    ? warn(
        "equals-word",
        `${equals.text} starts with an unquoted =, which zsh expands as a command lookup ("${equals.text.slice(1)} not found"). ` +
          `Instead, quote it: '${equals.text}'.`,
      )
    : null;
}

export async function evaluateBash(
  command: string,
  ctx: GuardContext,
): Promise<Verdict> {
  const found: Finding[] = [unquotedGlob(command), globQualifier(command)];
  for (const segment of splitSegments(command)) {
    found.push(...(await checkBashSegment(segment, ctx)));
  }
  found.push(await bareGlob(command, ctx), equalsWord(command));
  // Each finding takes its own rule's mode first; any block wins, else every warning is joined.
  return weigh(found.map((finding) => applyMode(finding, ctx)));
}
