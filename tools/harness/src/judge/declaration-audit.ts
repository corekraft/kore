import { parseDeclaration } from "./declaration.js";

export type Audit = { ok: true } | { ok: false; reason: string };

/** Audits a PR body: exactly one valid `Safety pattern:` line, and it is the last line. */
export function auditDeclaration(body: string): Audit {
  const declaration = parseDeclaration(body);
  if (!declaration.ok) {
    return { ok: false, reason: declaration.reason };
  }
  const last = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .at(-1);
  return last !== undefined && /^Safety pattern:/i.test(last)
    ? { ok: true }
    : {
        ok: false,
        reason:
          "The `Safety pattern:` line must be the last line of the PR body. Move it to the end.",
      };
}
