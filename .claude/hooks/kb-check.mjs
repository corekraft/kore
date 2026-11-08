#!/usr/bin/env node
// Knowledge health check: reports relative Markdown links and anchors that do
// not resolve, index entries that are missing or stale, plans and ADRs with
// missing or invalid frontmatter, `Docs:`/`Plan:`/`ADR:` comment markers that
// do not resolve, and top-level `kore` commands that README.md does not mention.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check
// Node standard library only.
//
// Usage: node .claude/hooks/kb-check.mjs [--strict]
// Warn mode prints findings and exits 0; --strict exits 1 when there are any.
// Stale plans and ADRs (older last-verified than a file they depend on) are
// listed as warnings only; --strict ignores them.
// Plan: infra/plans/5-self-maintenance.md#step-5-stale-documents

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";

const INDEX = "docs/index.md";
const CLI = "tools/kore/src/cli/cli.ts";
const PLAN = /^infra\/plans\/[^/]+\.md$/;
const ADR = /^docs\/decisions\/[^/]+\.md$/;
const SKILL = /^skills\/[^/]+\/SKILL\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const MARKER =
  /^\s*(?:\/\/|#|\*|--|<!--)\s*(Docs|Plan|ADR):\s+([^\s#]+)(?:#(\S+))?/;

/** The GitHub anchor slug of a heading's text. */
export function slug(heading) {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Lines outside fenced code blocks, with inline code removed: [{line, text}]. */
function proseLines(markdown) {
  const lines = [];
  let fence = null;
  markdown.split("\n").forEach((text, index) => {
    const opener = /^\s*(```|~~~)/.exec(text);
    if (fence) {
      if (opener && opener[1] === fence) fence = null;
      return;
    }
    if (opener) {
      fence = opener[1];
      return;
    }
    lines.push({ line: index + 1, text: text.replace(/`[^`]*`/g, "") });
  });
  return lines;
}

/** Every heading anchor in a Markdown file, numbering duplicates as GitHub does. */
function anchors(markdown) {
  const seen = new Map();
  const result = [];
  for (const { text } of proseLines(markdown)) {
    const match = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(text);
    if (!match) continue;
    const base = slug(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.push(count ? `${base}-${count}` : base);
  }
  return result;
}

/** Resolve a link target against the directory of `from`; null when it leaves the repository. */
function resolve(from, target) {
  const joined = posix.normalize(posix.join(posix.dirname(from), target));
  if (joined === ".." || joined.startsWith("../")) return null;
  return joined.replace(/\/$/, "") || ".";
}

function isExternal(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

function finding(file, line, message, fix) {
  return { file, line, message, fix };
}

/** Parse flat frontmatter: {keys: Map(key -> {value, line}), errors}, or null when absent. */
function frontmatter(file, markdown) {
  const lines = markdown.split("\n");
  if (lines[0] !== "---") return null;
  const keys = new Map();
  const errors = [];
  for (let index = 1; index < lines.length; index++) {
    const text = lines[index];
    if (text === "---") return { keys, errors };
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(text);
    if (match && match[2] && !/^[[{|>&*!-]/.test(match[2])) {
      keys.set(match[1], { value: match[2].trim(), line: index + 1 });
    } else {
      const key = match ? match[1] : text.trim();
      errors.push(
        finding(
          file,
          index + 1,
          `frontmatter ${key} is not a scalar string`,
          "use flat key: value lines only",
        ),
      );
    }
  }
  return null;
}

function checkFrontmatter(file, markdown, exists) {
  const parsed = frontmatter(file, markdown);
  if (!parsed) {
    return [
      finding(
        file,
        1,
        "frontmatter is missing",
        "start the file with --- status, summary, and last-verified ---",
      ),
    ];
  }
  const adr = ADR.test(file);
  const statuses = adr
    ? ["proposed", "accepted", "superseded"]
    : ["active", "done"];
  const required = adr
    ? ["status", "date", "summary", "last-verified"]
    : ["status", "summary", "last-verified"];
  const { keys } = parsed;
  if (adr && keys.get("status")?.value === "superseded") {
    required.push("superseded-by");
  }
  const problems = [...parsed.errors];
  const status = keys.get("status");
  if (status && !statuses.includes(status.value)) {
    problems.push(
      finding(
        file,
        status.line,
        `frontmatter status is ${status.value}`,
        `use one of ${statuses.join(", ")}`,
      ),
    );
  }
  for (const key of ["date", "last-verified"]) {
    const entry = keys.get(key);
    if (entry && (adr || key !== "date") && !DATE.test(entry.value)) {
      problems.push(
        finding(
          file,
          entry.line,
          `frontmatter ${key} is ${entry.value}`,
          "use a YYYY-MM-DD date",
        ),
      );
    }
  }
  const replacement = keys.get("superseded-by");
  if (adr && replacement && !exists(replacement.value)) {
    problems.push(
      finding(
        file,
        replacement.line,
        `frontmatter superseded-by ${replacement.value} does not exist`,
        "use the replacing ADR's path from the repository root",
      ),
    );
  }
  problems.sort((a, b) => a.line - b.line);
  for (const key of required) {
    if (!keys.has(key)) {
      problems.push(
        finding(file, 1, `frontmatter ${key} is missing`, `add a ${key}: line`),
      );
    }
  }
  return problems;
}

/** Every knowledge-base problem in the tree, each with file, line, message, and fix. */
export function findings(deps) {
  const files = [...deps.files()].sort();
  const tracked = new Set(files);
  const exists = (path) =>
    tracked.has(path) ||
    path === "." ||
    files.some((file) => file.startsWith(`${path}/`));
  const anchorCache = new Map();
  const anchorsOf = (path) => {
    if (!anchorCache.has(path)) {
      anchorCache.set(path, anchors(deps.read(path) ?? ""));
    }
    return anchorCache.get(path);
  };
  const anchorProblem = (file, line, label, target, anchor) => {
    if (!target.endsWith(".md") || !tracked.has(target)) return null;
    const known = anchorsOf(target);
    if (known.includes(anchor.toLowerCase())) return null;
    return finding(
      file,
      line,
      `${label} #${anchor} is not a heading in ${target}`,
      known.length
        ? `use one of its heading slugs, e.g. #${known[0]}`
        : "remove the anchor; the file has no headings",
    );
  };

  const problems = [];
  const markdown = files.filter((file) => file.endsWith(".md"));

  for (const file of markdown) {
    const text = deps.read(file);
    if (text === null) continue;
    for (const { line, text: prose } of proseLines(text)) {
      for (const [, raw] of prose.matchAll(LINK)) {
        if (isExternal(raw)) continue;
        const [pathPart, anchor] = raw.split("#", 2);
        const target = pathPart ? resolve(file, decodeURI(pathPart)) : file;
        if (target === null || !exists(target)) {
          problems.push(
            finding(
              file,
              line,
              `link target ${target ?? pathPart} does not exist`,
              "point the link at an existing file or remove it",
            ),
          );
          continue;
        }
        if (anchor) {
          const problem = anchorProblem(
            file,
            line,
            "link anchor",
            target,
            anchor,
          );
          if (problem) problems.push(problem);
        }
      }
    }
    if (PLAN.test(file) || ADR.test(file)) {
      problems.push(...checkFrontmatter(file, text, exists));
    }
  }

  const index = tracked.has(INDEX) ? deps.read(INDEX) : null;
  if (index === null) {
    problems.push(
      finding(
        INDEX,
        1,
        "the knowledge index is missing",
        "create it with one entry per plan, ADR, and skill",
      ),
    );
  } else {
    const listed = new Set();
    for (const { line, text } of proseLines(index)) {
      if (!text.startsWith("- [")) continue;
      const match = /\]\(([^)\s#]+)/.exec(text);
      if (!match || isExternal(match[1])) continue;
      const target = resolve(INDEX, decodeURI(match[1]));
      if (target) listed.add(target);
      if (target === null || !exists(target)) {
        problems.push(
          finding(
            INDEX,
            line,
            `index entry ${target ?? match[1]} names a missing file`,
            "remove the entry or restore the file",
          ),
        );
      }
    }
    for (const file of files) {
      if (!(PLAN.test(file) || ADR.test(file) || SKILL.test(file))) continue;
      if (!listed.has(file)) {
        problems.push(
          finding(
            INDEX,
            1,
            `${file} is not in the index`,
            "add an entry under its ## heading",
          ),
        );
      }
    }
  }

  for (const file of files) {
    if (file.endsWith(".md")) continue;
    const text = deps.read(file);
    if (text === null) continue;
    text.split("\n").forEach((line, position) => {
      const match = MARKER.exec(line);
      if (!match) return;
      const [, label, rawPath, anchor] = match;
      const path = rawPath.replace(/[.,;:)]+$/, "");
      if (!exists(path)) {
        problems.push(
          finding(
            file,
            position + 1,
            `${label}: path ${path} does not exist`,
            "use a path from the repository root",
          ),
        );
        return;
      }
      if (anchor) {
        const problem = anchorProblem(
          file,
          position + 1,
          `${label}: anchor`,
          path,
          anchor.replace(/[.,;:)]+$/, ""),
        );
        if (problem) problems.push(problem);
      }
    });
  }

  const cli = tracked.has(CLI) ? deps.read(CLI) : null;
  const readme = tracked.has("README.md") ? deps.read("README.md") : null;
  if (cli !== null && readme !== null) {
    const seen = new Set();
    let inUsage = false;
    cli.split("\n").forEach((line, position) => {
      if (/^\s*Usage:\s*$/.test(line)) {
        inUsage = true;
        return;
      }
      if (!inUsage) return;
      if (!line.trim()) {
        inUsage = false;
        return;
      }
      const command = /^\s+kore\s+([a-z][\w-]*)/.exec(line)?.[1];
      if (!command || seen.has(command)) return;
      seen.add(command);
      // nosemgrep: kore-dynamic-regexp -- command is matched by [a-z][\w-]* above, so it has no regex metacharacters
      if (!new RegExp(`\\bkore(?: --)? ${command}\\b`).test(readme)) {
        problems.push(
          finding(
            CLI,
            position + 1,
            `kore ${command} is in the CLI usage text but README.md does not mention it`,
            "document it in README.md",
          ),
        );
      }
    });
  }

  return problems;
}

/**
 * Plans and ADRs whose `last-verified` date is older than the latest commit to
 * a file they link to, or to a file whose Docs/Plan/ADR marker points at them.
 * Needs deps.commitDate(path): the date (YYYY-MM-DD) of the newest commit that
 * touched the file, or null when it has none. Without it nothing is stale.
 */
export function staleDocuments(deps) {
  if (!deps.commitDate) return [];
  const files = [...deps.files()].sort();
  const tracked = new Set(files);
  const dependencies = new Map();
  const depend = (document, path) => {
    if (path === document || !tracked.has(path)) return;
    if (!dependencies.has(document)) dependencies.set(document, new Set());
    dependencies.get(document).add(path);
  };
  for (const file of files) {
    const text = deps.read(file);
    if (text === null) continue;
    if (PLAN.test(file) || ADR.test(file)) {
      for (const { text: prose } of proseLines(text)) {
        for (const [, raw] of prose.matchAll(LINK)) {
          if (isExternal(raw)) continue;
          const [pathPart] = raw.split("#", 1);
          if (!pathPart) continue;
          const target = resolve(file, decodeURI(pathPart));
          if (target !== null) depend(file, target);
        }
      }
    }
    if (file.endsWith(".md")) continue;
    for (const line of text.split("\n")) {
      const match = MARKER.exec(line);
      if (!match) continue;
      const path = match[2].replace(/[.,;:)]+$/, "");
      if (PLAN.test(path) || ADR.test(path)) depend(path, file);
    }
  }
  const stale = [];
  for (const [document, paths] of dependencies) {
    const verified = frontmatter(document, deps.read(document) ?? "")?.keys.get(
      "last-verified",
    )?.value;
    if (!verified || !DATE.test(verified)) continue;
    let newest = null;
    for (const path of [...paths].sort()) {
      const date = deps.commitDate(path);
      if (date && (newest === null || date > newest.date)) {
        newest = { path, date };
      }
    }
    if (newest && newest.date > verified) {
      stale.push({ document, verified, ...newest });
    }
  }
  return stale.sort((a, b) => a.document.localeCompare(b.document));
}

/** One finding as `file:line: message; fix`. */
export function format(problem) {
  return `${problem.file}:${problem.line}: ${problem.message}; ${problem.fix}`;
}

/** Tracked and untracked-but-not-ignored regular files under root. */
function realDeps(root) {
  return {
    commitDate: (path) =>
      execFileSync("git", ["log", "-1", "--format=%cs", "--", path], {
        cwd: root,
        encoding: "utf8",
      }).trim() || null,
    files: () =>
      execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd: root, encoding: "utf8" },
      )
        .split("\0")
        .filter(Boolean)
        .filter((path) => {
          try {
            return statSync(posix.join(root, path)).isFile();
          } catch (error) {
            if (error?.code === "ENOENT") return false;
            throw error;
          }
        }),
    read: (path) => {
      try {
        return readFileSync(posix.join(root, path), "utf8");
      } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "EISDIR") return null;
        throw error;
      }
    },
  };
}

/** Print findings through log and return the exit code: 1 only for findings under --strict. */
export function run(argv, deps, log) {
  const strict = argv.includes("--strict");
  const problems = findings(deps);
  for (const problem of problems) log(format(problem));
  // Staleness is warn-only for now: it never changes the exit code, even --strict.
  const stale = staleDocuments(deps);
  for (const item of stale) {
    log(
      `stale: ${item.document} was last verified ${item.verified}, but ${item.path} changed ${item.date}; re-read it and update last-verified`,
    );
  }
  const staleNote = () => {
    if (stale.length === 0) return;
    log(
      `kb-check: ${stale.length} stale ${stale.length === 1 ? "document" : "documents"} (warn only)`,
    );
  };
  if (problems.length === 0) {
    if (stale.length === 0) {
      log("kb-check: clean");
    } else {
      staleNote();
    }
    return 0;
  }
  const noun = problems.length === 1 ? "finding" : "findings";
  log(
    strict
      ? `kb-check: ${problems.length} ${noun}`
      : `kb-check: ${problems.length} ${noun} (warn mode; --strict fails on them)`,
  );
  staleNote();
  return strict ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  process.exitCode = run(process.argv.slice(2), realDeps(root), console.log);
}
