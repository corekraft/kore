import { createHash, type Hash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { join, posix } from "node:path";

// Docs: AGENTS.md "Deploy what was verified."

/** Docker sends these to the daemon whatever .dockerignore says. */
const alwaysSent = new Set(["Dockerfile", ".dockerignore"]);

type Token =
  | { kind: "literal"; char: string }
  | { kind: "star" }
  | { kind: "one" }
  | { kind: "deep" }
  | { kind: "deepDirectories" };

interface Rule {
  tokens: Token[];
  negated: boolean;
}

/** `*` and `?` stay inside one path segment; `**` crosses segments. */
function tokensOf(line: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === "*" && line[index + 1] === "*") {
      index += 1;
      if (line[index + 1] === "/") {
        index += 1;
        tokens.push({ kind: "deepDirectories" });
      } else {
        tokens.push({ kind: "deep" });
      }
    } else if (char === "*") {
      tokens.push({ kind: "star" });
    } else if (char === "?") {
      tokens.push({ kind: "one" });
    } else {
      tokens.push({ kind: "literal", char });
    }
  }
  return tokens;
}

/** Whether `tokens` match all of `text`; no regular expression, no backtracking blowup. */
function globMatches(tokens: Token[], text: string): boolean {
  const memo = new Map<number, boolean>();
  const at = (t: number, c: number): boolean => {
    const key = t * (text.length + 1) + c;
    const known = memo.get(key);
    if (known !== undefined) {
      return known;
    }
    const result = step(t, c);
    memo.set(key, result);
    return result;
  };
  const spanning = (
    t: number,
    c: number,
    within: (char: string) => boolean,
  ) => {
    for (let end = c; end <= text.length; end += 1) {
      if (at(t + 1, end)) {
        return true;
      }
      if (end === text.length || !within(text[end]!)) {
        return false;
      }
    }
    return false;
  };
  const step = (t: number, c: number): boolean => {
    const token = tokens[t];
    if (token === undefined) {
      return c === text.length;
    }
    switch (token.kind) {
      case "literal":
        return text[c] === token.char && at(t + 1, c + 1);
      case "one":
        return c < text.length && text[c] !== "/" && at(t + 1, c + 1);
      case "star":
        return spanning(t, c, (char) => char !== "/");
      case "deep":
        return spanning(t, c, () => true);
      default:
        // deepDirectories: zero or more whole directories, so nothing or text through a slash
        return (
          at(t + 1, c) ||
          Array.from(text.slice(c)).some(
            (char, offset) => char === "/" && at(t + 1, c + offset + 1),
          )
        );
    }
  };
  return at(0, 0);
}

function rulesOf(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const negated = line.startsWith("!");
    const cleaned = posix
      .normalize((negated ? line.slice(1) : line).trim())
      .replace(/^\/+/, "");
    if (cleaned !== "" && cleaned !== ".") {
      rules.push({ tokens: tokensOf(cleaned), negated });
    }
  }
  return rules;
}

/**
 * A path is excluded when the last rule matching it, or one of its parent
 * directories, says so. Patterns are rooted at the context, so `node_modules`
 * excludes only the top-level one.
 */
function excluded(rules: Rule[], path: string): boolean {
  const segments = path.split("/");
  let result = false;
  for (const rule of rules) {
    const matches = segments.some((_, index) =>
      globMatches(rule.tokens, segments.slice(0, index + 1).join("/")),
    );
    if (matches) {
      result = !rule.negated;
    }
  }
  return result;
}

/** Each field carries its length, so no content can pose as a path or another field. */
function frame(hash: Hash, field: string | Buffer): void {
  const bytes = typeof field === "string" ? Buffer.from(field) : field;
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  hash.update(length);
  hash.update(bytes);
}

async function missing<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function walk(
  root: string,
  rules: Rule[],
  hash: Hash,
  directory = "",
): Promise<void> {
  const entries = await readdir(join(root, directory), {
    withFileTypes: true,
  });
  const keepsNegations = rules.some((rule) => rule.negated);
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
    const skipped = excluded(rules, path) && !alwaysSent.has(path);
    if (skipped && !(entry.isDirectory() && keepsNegations)) {
      continue;
    }
    const stats = await lstat(join(root, path));
    if (!skipped) {
      frame(hash, path);
      frame(hash, String(stats.mode & 0o7777));
      if (stats.isSymbolicLink()) {
        frame(hash, "l");
        frame(hash, await readlink(join(root, path)));
      } else if (stats.isFile()) {
        frame(hash, "f");
        frame(hash, await readFile(join(root, path)));
      } else {
        frame(hash, "d");
      }
    }
    if (stats.isDirectory()) {
      await walk(root, rules, hash, path);
    }
  }
}

export interface ContextInputs {
  /** A hash of everything docker would send, or undefined when there is no context. */
  hash: string | undefined;
  dockerfile: string | undefined;
}

/**
 * Hashes the build context the way docker reads it: .dockerignore rules, link
 * targets (never followed) and file modes, each field length-prefixed.
 */
export async function contextInputs(context: string): Promise<ContextInputs> {
  const dockerfile = await missing(
    async () => await readFile(join(context, "Dockerfile"), "utf8"),
  );
  if (dockerfile === undefined) {
    return { hash: undefined, dockerfile: undefined };
  }
  const ignore = await missing(
    async () => await readFile(join(context, ".dockerignore"), "utf8"),
  );
  const hash = createHash("sha256");
  await walk(context, rulesOf(ignore ?? ""), hash);
  return { hash: hash.digest("hex"), dockerfile };
}

/**
 * A registry tag naming everything the image is built from: the context, the
 * resolved base images and the platform. A docker build stamps a creation
 * time, so one source builds a new digest each run; this tag lets a run find
 * the image an earlier run built from the same inputs.
 */
export function sourceTagOf(
  contextHash: string,
  bases: readonly string[],
  platform: string,
): string {
  const hash = createHash("sha256");
  for (const field of [contextHash, platform, ...bases]) {
    frame(hash, field);
  }
  return `kore-src-${hash.digest("hex").slice(0, 16)}`;
}
