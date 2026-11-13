// A bare glob that matches no path fails the whole command in zsh ("no matches
// found"), so the rule warns for each unquoted glob that matches nothing. A glob
// that matches is expanded as the author meant, and stays silent. Audit mode.
import { rawWords, shellText } from "./guard-shell.js";
import { warn, type Finding, type GuardContext } from "./guard-verdict.js";

export async function bareGlob(
  command: string,
  ctx: GuardContext,
): Promise<Finding> {
  const text = shellText(command).replace(/\$?\(\([^)]*\)\)/g, "");
  const globs = rawWords(text).filter(
    (word) => word.glob && !word.text.includes("${"),
  );
  const matched = await Promise.all(
    globs.map((glob) => ctx.globMatches(glob.text)),
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
