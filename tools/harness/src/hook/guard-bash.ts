// Bash rules: split a command into segments and check each one. A block in any
// segment wins; otherwise the first warning stands.
import { checkAppendOnly } from "./guard-append-only.js";
import {
  checkContext,
  checkDestructive,
  checkIdeaIssueBody,
  checkIdeaIssueClose,
  checkNoVerify,
} from "./guard-commands.js";
import {
  SECRET_PATH,
  SECRET_SAFE,
  loadSopsPatterns,
  secretBlock,
  sopsBlock,
} from "./guard-secrets.js";
import {
  commandOf,
  isKore,
  rawWords,
  shellText,
  splitSegments,
} from "./guard-shell.js";
import {
  allow,
  block,
  warn,
  type Finding,
  type GuardContext,
  type Verdict,
} from "./guard-verdict.js";

async function sopsWrite(
  name: string,
  segment: string[],
  text: string,
  ctx: GuardContext,
): Promise<Finding> {
  const writes =
    text.includes(">") || ["tee", "cp", "mv", "sed"].includes(name);
  if (name === "sops" || !writes) {
    return null;
  }
  const patterns = await loadSopsPatterns(ctx);
  const target = segment.find((token) => {
    const path = token.replace(/^>+/, "");
    return patterns.some((pattern) => pattern.test(path));
  });
  return target ? sopsBlock(target.replace(/^>+/, "")) : null;
}

async function checkBashSegment(
  segment: string[],
  ctx: GuardContext,
): Promise<Finding> {
  const { name, args } = commandOf(segment);
  if (!name) {
    return null;
  }
  const text = segment.join(" ");

  if (!SECRET_SAFE.has(name) && !isKore(name, args) && SECRET_PATH.test(text)) {
    return secretBlock();
  }

  return (
    (await sopsWrite(name, segment, text, ctx)) ??
    checkDestructive(name, args) ??
    checkContext(name, args) ??
    checkNoVerify(name, args) ??
    checkIdeaIssueBody(name, args) ??
    checkIdeaIssueClose(name, args) ??
    checkAppendOnly(name, args, segment, ctx.root)
  );
}

// An unquoted glob in --include/--exclude: zsh expands it and, when nothing
// matches, fails the whole command before it runs. Blocks: every warning in
// the 2026-11-08 retrospective was heeded and none was overridden.
const UNQUOTED_GLOB = /(?:^|\s)--(include|exclude)=([^\s'"]*\*[^\s'"]*)/;

function unquotedGlob(command: string): Finding {
  const match = UNQUOTED_GLOB.exec(shellText(command));
  if (!match) {
    return null;
  }
  return block(
    "unquoted-glob",
    `--${match[1]}=${match[2]} is unquoted; zsh fails the whole command when the glob matches no file. ` +
      `Instead, quote it: --${match[1]}='${match[2]}'.`,
  );
}

// zsh pitfalls beyond --include/--exclude, in audit mode (warn): a bare glob
// that matches nothing fails with "no matches found", and a word starting
// with = is expanded as a command lookup ("== not found").
function zshWords(command: string): Finding {
  const text = shellText(command).replace(/\$\(\([^)]*\)\)/g, "");
  for (const word of rawWords(text)) {
    if (word.glob && !word.text.includes("${")) {
      return warn(
        "bare-glob",
        `${word.text} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ` +
          `Instead, quote it ('${word.text}') unless it must expand, and check that it matches.`,
      );
    }
    if (word.equals && !text.includes("[[")) {
      return warn(
        "equals-word",
        `${word.text} starts with an unquoted =, which zsh expands as a command lookup ("${word.text.slice(1)} not found"). ` +
          `Instead, quote it: '${word.text}'.`,
      );
    }
  }
  return null;
}

export async function evaluateBash(
  command: string,
  ctx: GuardContext,
): Promise<Verdict> {
  const glob = unquotedGlob(command);
  if (glob) {
    return glob;
  }
  let warning: Finding = null;
  for (const segment of splitSegments(command)) {
    const result = await checkBashSegment(segment, ctx);
    if (result?.action === "block") {
      return result;
    }
    warning ??= result;
  }
  return warning ?? zshWords(command) ?? allow;
}
