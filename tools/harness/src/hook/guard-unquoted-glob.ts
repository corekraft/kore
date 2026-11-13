// The `unquoted-glob` rule for --include/--exclude: zsh expands an unquoted glob
// and, when nothing matches, fails the whole command before it runs. The block
// names the corrected command, every such glob quoted, so the retry is a copy.
import { shellText } from "./guard-shell.js";
import { block, type Finding } from "./guard-verdict.js";

const UNQUOTED_GLOB =
  /(^|\s)--(include|exclude)=([^\s'";&|()<>]*\*[^\s'";&|()<>]*)/g;

export function unquotedGlob(command: string): Finding {
  // The checked text stops at a heredoc marker's line; the rest of the command is kept as written.
  const checked = shellText(command);
  const corrected = checked.replace(
    UNQUOTED_GLOB,
    (_match, lead: string, flag: string, glob: string) =>
      `${lead}--${flag}='${glob}'`,
  );
  const [first] = checked.matchAll(UNQUOTED_GLOB);
  if (!first) {
    return null;
  }
  const [, , flag, glob] = first;
  return block(
    "unquoted-glob",
    `--${flag}=${glob} is unquoted; zsh fails the whole command when the glob matches no file. ` +
      `Instead, run: ${corrected + command.slice(checked.length)}`,
  );
}
