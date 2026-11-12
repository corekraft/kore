export const PATTERNS = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
  "expand-contract",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export type Declaration =
  | { ok: true; pattern: Pattern; idea: string | undefined }
  | { ok: false; reason: string };

const FIELD = "Safety pattern:";
const FIX = `Add exactly one \`${FIELD} <pattern>\` line to the PR body (see .github/pull_request_template.md), where <pattern> is one of ${PATTERNS.join(", ")}.`;

function lines(body: string, label: string): string[] {
  // Text inside an HTML comment is template guidance, not a declaration.
  const visible = body.replace(/<!--[\s\S]*?-->/g, "");
  const found: string[] = [];
  for (const line of visible.split("\n")) {
    const match = new RegExp(`^\\s*${label}\\s*(.*?)\\s*$`, "i").exec(line);
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
  const declared = lines(body, FIELD);
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
  const idea = lines(body, "Idea:")[0];
  return { ok: true, pattern: value, idea: idea === "" ? undefined : idea };
}
