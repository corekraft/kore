// A bare glob that matches no path fails the whole command in zsh ("no matches
// found"), so the rule warns for each unquoted glob that matches nothing. A glob
// that matches is expanded as the author meant, and stays silent. Audit mode.
import { rawWords, shellText } from "./guard-shell.js";
import { warn, type Finding, type GuardContext } from "./guard-verdict.js";

// A pattern that is absolute, starts with ~ or .., or walks with ** is not walked
// on this hook, which runs before every Bash call: it counts as unmatched and warns.
const WALKABLE = (pattern: string): boolean =>
  !/^(\/|~|\.\.)/.test(pattern) && !pattern.includes("**");

// An audit rule never changes a verdict: a match that fails counts as unmatched.
async function matches(ctx: GuardContext, pattern: string): Promise<boolean> {
  if (!WALKABLE(pattern)) {
    return false;
  }
  return ctx.globMatches(pattern).catch(() => false);
}

export async function bareGlob(
  command: string,
  ctx: GuardContext,
): Promise<Finding> {
  const text = shellText(command).replace(/\$?\(\([^)]*\)\)/g, "");
  const globs = rawWords(text).filter(
    (word) => word.glob && !word.text.includes("${"),
  );
  const matched = await Promise.all(
    globs.map((glob) => matches(ctx, glob.text)),
  );
  const unmatched = globs.find((_glob, index) => !matched[index]);
  return unmatched
    ? warn(
        "bare-glob",
        `${unmatched.text} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ` +
          `Instead, quote it ('${unmatched.text}') unless it must expand, and check that it matches.`,
      )
    : null;
}
