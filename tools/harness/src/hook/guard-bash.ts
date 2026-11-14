// Bash rules: split a command into segments and check each one. A block in any
// segment wins; otherwise the first warning stands.
import {
  checkDenyRemovalBash,
  checkGuardrailBash,
} from "./guard-guardrails.js";
import { checkRulesetSyncBash } from "./guard-ruleset.js";
import { checkDenyAudit } from "./guard-deny.js";
import { checkAppendOnly } from "./guard-append-only.js";
import {
  bareGlob,
  checkAgentStart,
  checkContext,
  checkDestructive,
  checkIdeaIssueBody,
  checkIdeaIssueClose,
  checkNoVerify,
  unquotedGlob,
} from "./guard-commands.js";
import {
  SECRET_PATH,
  SECRET_SAFE,
  keychainBlock,
  loadSopsPatterns,
  readsKoreKeychain,
  secretBlock,
  sopsBlock,
} from "./guard-secrets.js";
import {
  commandOf,
  execGlobQualifier,
  isKore,
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
): Promise<Finding[]> {
  const { name, args } = commandOf(segment);
  if (!name) {
    return [];
  }
  const text = segment.join(" ");

  if (!SECRET_SAFE.has(name) && !isKore(name, args) && SECRET_PATH.test(text)) {
    return [secretBlock()];
  }

  if (readsKoreKeychain(name, args)) {
    return [keychainBlock()];
  }

  // Every check runs: each finding takes its own rule's mode, so a promoted rule can block past an audit one.
  return [
    await sopsWrite(name, segment, text, ctx),
    checkDestructive(name, args),
    checkContext(name, args),
    checkNoVerify(name, args),
    checkIdeaIssueBody(name, args),
    checkIdeaIssueClose(name, args),
    checkAppendOnly(name, args, segment, ctx.root),
    checkGuardrailBash(name, args, segment),
    checkDenyRemovalBash(name, args),
    checkRulesetSyncBash(name, args),
    checkAgentStart(name, args),
    ...checkDenyAudit("Bash", text, ctx),
  ];
}

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
