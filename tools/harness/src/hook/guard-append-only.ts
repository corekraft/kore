// Append-only records: written only by their owning script, never by hand.
// Audit mode (warn).
import { warn, type Finding } from "./guard-verdict.js";

const APPEND_ONLY =
  /(^|[/\s>'"=])(\.claude\/evals\/history\.jsonl|\.kore\/state\/journal\/[^/\s'"]*\.jsonl|\.kore\/state\/ledger\.jsonl|\.kore\/state\/test-pass\/[^\s'"]+)$/;
export const isAppendOnly = (path: string): boolean => APPEND_ONLY.test(path);

export const appendOnlyWarn = (path: string): Finding =>
  warn(
    "append-only",
    `${path} is an append-only record: .claude/evals/history.jsonl is owned by eval.mjs, ` +
      `.kore/state/journal/*.jsonl by kore, .kore/state/ledger.jsonl by the harness ledger tool (\`harness ledger record\`), ` +
      `.kore/state/test-pass/ (a recorded test pass that lets the commit hook skip tests) by test-lock.mjs after a real green run. ` +
      `Instead, append through the owning script (eval.mjs, kore, harness ledger, test-lock.mjs); never edit, truncate, move, or remove it by hand.`,
  );

const TRUNCATING_REDIRECT = /^(?:\d*|&)>(?!>)(.*)$/;

// Removing or moving these directories removes every journal inside them.
const PROTECTED_DIRS = new Set([
  ".kore",
  ".kore/state",
  ".kore/state/journal",
  ".kore/state/test-pass",
]);

function isProtectedDir(arg: string, root: string): boolean {
  let path = arg.replace(/^\.\//, "").replace(/\/+$/, "");
  const base = root.replace(/\/+$/, "");
  if (base && path.startsWith(`${base}/`)) {
    path = path.slice(base.length + 1);
  }
  return PROTECTED_DIRS.has(path);
}

function truncatedTarget(
  segment: string[],
  matches: (path: string) => boolean,
): string | undefined {
  for (let i = 0; i < segment.length; i++) {
    const match = TRUNCATING_REDIRECT.exec(segment[i] as string);
    if (!match) {
      continue;
    }
    const target =
      ((match[1] as string).replace(/^\|/, "") || segment[i + 1]) ?? "";
    if (matches(target)) {
      return target;
    }
  }
  return undefined;
}

const inPlace = (arg: string): boolean =>
  /^-[A-Za-z]*i/.test(arg) || arg.startsWith("--in-place");

function rewrittenPath(
  name: string,
  args: string[],
  matches: (path: string) => boolean,
): string | undefined {
  const rewrites = (candidates: string[]) =>
    candidates.find((arg) => matches(arg));
  const operands = args.filter((arg) => !arg.startsWith("-"));
  const appends = args.some((arg) => arg === "-a" || arg === "--append");
  if (
    ["rm", "mv", "truncate"].includes(name) ||
    (name === "sed" && args.some(inPlace))
  ) {
    return rewrites(args);
  }
  if (name === "tee" && !appends) {
    return rewrites(operands);
  }
  return name === "cp" ? rewrites(operands.slice(-1)) : undefined;
}

export function checkAppendOnly(
  name: string,
  args: string[],
  segment: string[],
  root: string,
): Finding {
  if (name === "rm" || name === "mv") {
    const dir = args.find(
      (arg) => !arg.startsWith("-") && isProtectedDir(arg, root),
    );
    if (dir) {
      return appendOnlyWarn(dir);
    }
  }
  const path = writtenPath(name, args, segment, isAppendOnly);
  return path ? appendOnlyWarn(path) : null;
}

/** The path a command rewrites, truncates, moves or removes, when it matches. */
export function writtenPath(
  name: string,
  args: string[],
  segment: string[],
  matches: (path: string) => boolean,
): string | undefined {
  return (
    truncatedTarget(segment, matches) ?? rewrittenPath(name, args, matches)
  );
}
