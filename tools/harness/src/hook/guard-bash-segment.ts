// Checks one shell segment of a Bash command against the segment rules. guard-bash.ts
// splits the command into segments and joins the findings with its whole-command rules.
import {
  checkDenyRemovalBash,
  checkGuardrailBash,
} from "./guard-guardrails.js";
import { checkRulesetSyncBash } from "./guard-ruleset.js";
import { checkDenyAudit } from "./guard-deny.js";
import { checkAppendOnly } from "./guard-append-only.js";
import {
  checkAgentStart,
  checkContext,
  checkDestructive,
  checkIdeaIssueBody,
  checkIdeaIssueClose,
  checkNoVerify,
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
import { commandOf, isKore } from "./guard-shell.js";
import type { Finding, GuardContext } from "./guard-verdict.js";

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

export async function checkBashSegment(
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
