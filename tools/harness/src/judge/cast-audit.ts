// The type-cast audit item: a type cast (`as never`, `as unknown as`, or any other `as` assertion)
// on a line the pull request adds to a TypeScript file. `as const` and an import or export alias are
// not casts. It is an audit item: reported to the writer and the judge, never a reason to fail the
// check (AGENTS.md, Audit before enforce). It reads the diff's added lines only and needs no tokens.
import type { ChangedFile } from "./diff.js";
import type { AuditFinding } from "./file-length.js";

export const CAST_ITEM = "type-cast";

const FIX =
  "replace the cast with a type guard or a corrected declared type (AGENTS.md, Strict types)";

/** The files the strict-types rule reads: TypeScript, tests included (the rule has no test exemption). */
const TYPESCRIPT = /\.[cm]?tsx?$/;

/** Built-in type names: an `as` before one of these is a cast even on a line that reads like an alias. */
const BUILT_IN = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
  "unknown",
  "void",
]);

const AS = /\bas\b/g;
/** The text before an `as` inside an import or export brace list: `import { a`, `export type { a`, `import x, { a`. */
const IMPORT_BRACES =
  /^\s*(?:import|export)(?:\s+type)?\s+(?:[\w$]+\s*,\s*)?\{[^{}()=;]*$/;
/** A line that is only one alias entry of a multi-line import or export list: `renamed as local,`. */
const ALIAS_LINE = /^\s*(?:type\s+)?[\w$]+\s+as\s+[\w$]+\s*,?\s*(?:\}.*)?$/;

/** The line with its strings and comments blanked, so only code is read; a comment-only line reads as nothing. */
function codeOf(line: string): string {
  if (/^\s*(?:\/\/|\/\*|\*)/.test(line)) {
    return "";
  }
  return line
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')
    .replace(/\/\/.*$/, "")
    .replace(/\/\*.*?\*\//g, "");
}

/** Whether the `as` at this point is an alias: a namespace alias, a named alias in a brace list, or an alias entry line. */
function isAlias(before: string, line: string, target: string): boolean {
  return (
    /\*\s*$/.test(before) ||
    IMPORT_BRACES.test(before) ||
    (ALIAS_LINE.test(line) && !BUILT_IN.has(target))
  );
}

/** The cast phrases on one line of code: `as never`, `as Foo`, and one `as unknown as` for a double cast. */
function castsIn(code: string): string[] {
  const phrases: string[] = [];
  for (const match of code.matchAll(AS)) {
    const at = match.index;
    const before = code.slice(0, at);
    const after = code.slice(at + 2);
    const target = /^\s+([\w$]+|[{[(<])/.exec(after)?.[1];
    if (
      target === undefined ||
      target === "const" ||
      isAlias(before, code, target) ||
      /\bas\s+unknown\s*$/.test(before)
    ) {
      continue;
    }
    phrases.push(
      /^\s+unknown\s+as\b/.test(after) ? "as unknown as" : `as ${target}`,
    );
  }
  return phrases;
}

/**
 * The audit findings for the casts the changed TypeScript files add: each cast on an added line,
 * with its file, its line and the fix. A deleted file, a file that is not TypeScript, and a line
 * the PR did not add are not read.
 */
export function castAudit(files: readonly ChangedFile[]): AuditFinding[] {
  return files
    .filter((f) => !f.deleted && TYPESCRIPT.test(f.path))
    .flatMap((f) =>
      f.addedLines.flatMap(({ line, text }) =>
        castsIn(codeOf(text)).map((detail) => ({
          item: CAST_ITEM,
          file: f.path,
          line,
          detail,
          fix: FIX,
        })),
      ),
    );
}
