// A bare glob that matches no path fails the whole command in zsh ("no matches
// found"), so the rule warns for each unquoted glob that matches nothing. A glob
// that matches is expanded as the author meant, and stays silent. A glob
// character in a pattern argument is data, not a path, and stays silent too.
// Audit mode.
import {
  commandOf,
  rawSegments,
  shellText,
  type RawWord,
} from "./guard-shell.js";
import { warn, type Finding, type GuardContext } from "./guard-verdict.js";

// A pattern that is absolute, starts with ~ or .., or walks with ** is not walked
// on this hook, which runs before every Bash call: it counts as unmatched and warns.
const WALKABLE = (pattern: string): boolean =>
  !/^(\/|~|\.\.)/.test(pattern) && !pattern.includes("**");

// An audit rule never changes a verdict: a match that fails counts as unmatched.
async function matches(ctx: GuardContext, pattern: string): Promise<boolean> {
  if (!WALKABLE(pattern)) {
    return false;
  }
  return ctx.globMatches(pattern).catch(() => false);
}

// Commands whose first non-option argument is a pattern, not a path (`git grep` included).
const PATTERN_TOOLS = new Set(["grep", "egrep", "fgrep", "rg", "sed", "awk"]);
// Operators of a [[ ]] comparison: the word after one is a pattern.
const COMPARISON = new Set(["==", "=", "!=", "=~"]);

/** The pattern of a search tool: the word after -e, else the first word that is not an option. */
function patternOf(args: readonly RawWord[]): RawWord | undefined {
  const explicit = args.findIndex(
    (word) => word.text === "-e" || word.text === "--regexp",
  );
  if (explicit >= 0) {
    return args[explicit + 1];
  }
  if (args.some((word) => word.text === "-f" || word.text === "--file")) {
    return undefined;
  }
  return args.find((word) => !word.text.startsWith("-"));
}

interface PatternScan {
  readonly patterns: Set<RawWord>;
  inCase: boolean;
  inDoubleBracket: boolean;
}

/** A word after `case ... in`, or the first word of each arm until `esac`, is a case pattern. */
function scanCase(segment: readonly RawWord[], scan: PatternScan): void {
  const head = segment[0] as RawWord;
  if (scan.inCase) {
    if (head.text === "esac") {
      scan.inCase = false;
    } else {
      scan.patterns.add(head);
    }
    return;
  }
  const inAt = segment.findIndex((word) => word.text === "in");
  if (head.text === "case" && inAt >= 0) {
    scan.inCase = true;
    const first = segment[inAt + 1];
    if (first) {
      scan.patterns.add(first);
    }
  }
}

/** Inside [[ ]], the word after a comparison operator is a pattern; a lone * is an operand. */
function scanDoubleBracket(
  segment: readonly RawWord[],
  scan: PatternScan,
): void {
  let afterComparison = false;
  for (const word of segment) {
    if (word.text === "[[" || word.text === "]]") {
      scan.inDoubleBracket = word.text === "[[";
      afterComparison = false;
    } else if (scan.inDoubleBracket) {
      if (afterComparison || word.text === "*") {
        scan.patterns.add(word);
      }
      afterComparison = COMPARISON.has(word.text);
    }
  }
}

/** The pattern words of a search tool, and a lone * operand of a test, in one command segment. */
function scanTool(segment: readonly RawWord[], scan: PatternScan): void {
  const { name, args } = commandOf(segment.map((word) => word.text));
  const argWords = segment.slice(segment.length - args.length);
  const isGitGrep = name === "git" && args[0] === "grep";
  const tool = isGitGrep ? "grep" : name;
  const words = isGitGrep ? argWords.slice(1) : argWords;
  if (PATTERN_TOOLS.has(tool)) {
    const pattern = patternOf(words);
    if (pattern) {
      scan.patterns.add(pattern);
    }
  }
  if (tool === "[" || tool === "test") {
    for (const word of words) {
      if (word.text === "*") {
        scan.patterns.add(word);
      }
    }
  }
}

/** The words that are patterns or operands, which the rule does not treat as globs. */
function patternWords(segments: readonly RawWord[][]): Set<RawWord> {
  const scan: PatternScan = {
    patterns: new Set(),
    inCase: false,
    inDoubleBracket: false,
  };
  for (const segment of segments) {
    scanCase(segment, scan);
    scanDoubleBracket(segment, scan);
    scanTool(segment, scan);
  }
  return scan.patterns;
}

export async function bareGlob(
  command: string,
  ctx: GuardContext,
): Promise<Finding> {
  const text = shellText(command).replace(/\$?\(\([^)]*\)\)/g, "");
  const segments = rawSegments(text);
  const patterns = patternWords(segments);
  const globs = segments
    .flat()
    .filter(
      (word) => word.glob && !word.text.includes("${") && !patterns.has(word),
    );
  const matched = await Promise.all(
    globs.map((glob) => matches(ctx, glob.text)),
  );
  const unmatched = globs.find((_glob, index) => !matched[index]);
  return unmatched
    ? warn(
        "bare-glob",
        `${unmatched.text} is an unquoted glob; zsh fails the whole command with "no matches found" when it matches no file. ` +
          `Instead, quote it ('${unmatched.text}') unless it must expand, and check that it matches.`,
      )
    : null;
}
