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
  applyMode,
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
// with = is expanded as a command lookup ("== not found"). One finding per rule.
function zshWords(command: string): Finding[] {
  const text = shellText(command).replace(/\$\(\([^)]*\)\)/g, "");
  const words = rawWords(text);
  const glob = words.find((w) => w.glob && !w.text.includes("${"));
  const equals = text.includes("[[") ? undefined : words.find((w) => w.equals);
  return [
    glob
      ? warn(
          "bare-glob",
          `${glob.text} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ` +
            `Instead, quote it ('${glob.text}') unless it must expand, and check that it matches.`,
        )
      : null,
    equals
      ? warn(
          "equals-word",
          `${equals.text} starts with an unquoted =, which zsh expands as a command lookup ("${equals.text.slice(1)} not found"). ` +
            `Instead, quote it: '${equals.text}'.`,
        )
      : null,
  ];
}

export async function evaluateBash(
  command: string,
  ctx: GuardContext,
): Promise<Verdict> {
  const glob = applyMode(unquotedGlob(command), ctx);
  const segments: Finding[] = [];
  for (const segment of splitSegments(command)) {
    segments.push(applyMode(await checkBashSegment(segment, ctx), ctx));
  }
  const zsh = zshWords(command).map((finding) => applyMode(finding, ctx));
  // Each finding takes its own rule's mode first; any block wins over any warning.
  const found = [glob, ...segments, ...zsh];
  return (
    found.find((finding) => finding?.action === "block") ??
    [...segments, glob, ...zsh].find((finding) => finding !== null) ??
    allow
  );
}
