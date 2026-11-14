export const PATTERNS = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
  "expand-contract",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export type Declaration =
  | {
      ok: true;
      pattern: Pattern;
      idea: string | undefined;
      /** The PR number of the merged expand step a contract names; undefined for any other PR. */
      expandStep: number | undefined;
    }
  | { ok: false; reason: string };

const FIELD = "Safety pattern:";
const FIX = `Add exactly one \`${FIELD} <pattern>\` line to the PR body (see .github/pull_request_template.md), where <pattern> is one of ${PATTERNS.join(", ")}.`;

const FIELDS = {
  pattern: /^\s*Safety pattern:\s*(.*?)\s*$/i,
  idea: /^\s*Idea:\s*(.*?)\s*$/i,
  expandStep: /^\s*Expand step:\s*(.*?)\s*$/i,
};

const EXPAND_STEP = /^#(\d+)$/;
const EXPAND_FIX =
  "Name the merged expand PR on one `Expand step: #<number>` line in the PR body.";

function lines(body: string, field: keyof typeof FIELDS): string[] {
  // Text inside an HTML comment is template guidance, not a declaration.
  const visible = body.replace(/<!--[\s\S]*?-->/g, "");
  const found: string[] = [];
  for (const line of visible.split("\n")) {
    const match = FIELDS[field].exec(line);
    if (match?.[1] !== undefined) {
      found.push(match[1].replace(/^`|`$/g, "").trim());
    }
  }
  return found;
}

const isPattern = (value: string): value is Pattern =>
  (PATTERNS as readonly string[]).includes(value);

/** Reads the one safety pattern a PR body declares, and the idea it links to. */
export function parseDeclaration(body: string): Declaration {
  const declared = lines(body, "pattern");
  if (declared.length !== 1) {
    return {
      ok: false,
      reason:
        declared.length === 0
          ? `The PR declares no safety pattern. ${FIX}`
          : `The PR declares ${declared.length} safety patterns; declare exactly one. ${FIX}`,
    };
  }
  const value = declared[0] ?? "";
  if (!isPattern(value)) {
    return {
      ok: false,
      reason:
        value === ""
          ? `The \`${FIELD}\` field is blank. ${FIX}`
          : `Unknown safety pattern "${value}". ${FIX}`,
    };
  }
  const idea = lines(body, "idea")[0];
  const expand = expandStepOf(body, value);
  if (!expand.ok) {
    return expand;
  }
  return {
    ok: true,
    pattern: value,
    idea: idea === "" ? undefined : idea,
    expandStep: expand.expandStep,
  };
}

/** Reads the one `Expand step: #<n>` line a contract may name; no line is no expand step. */
function expandStepOf(
  body: string,
  pattern: Pattern,
):
  { ok: true; expandStep: number | undefined } | { ok: false; reason: string } {
  const named = lines(body, "expandStep");
  if (named.length === 0) {
    return { ok: true, expandStep: undefined };
  }
  if (named.length > 1) {
    return {
      ok: false,
      reason: `The PR names ${named.length} expand steps; name exactly one expand step. ${EXPAND_FIX}`,
    };
  }
  if (pattern !== "expand-contract") {
    return {
      ok: false,
      reason: `Expand step applies only to expand-contract, but the PR declares ${pattern}. Remove the \`Expand step:\` line.`,
    };
  }
  const number = EXPAND_STEP.exec(named[0] ?? "")?.[1];
  return number === undefined
    ? {
        ok: false,
        reason: `Expand step "${named[0]}" is not a PR number. ${EXPAND_FIX}`,
      }
    : { ok: true, expandStep: Number(number) };
}
