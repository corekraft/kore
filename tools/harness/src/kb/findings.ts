// Every knowledge-base problem in the tree: links and anchors, the index,
// frontmatter, Docs/Plan/ADR markers, and README coverage of CLI commands.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { flowMetricNames } from "../flow/index.js";
import { commandFindings, type CommandDeps } from "./command-checks.js";
import { checkFrontmatter } from "./document-checks.js";
import { checkIdea, ideaNumbers } from "./idea-checks.js";
import {
  LINK,
  anchors,
  finding,
  isExternal,
  proseLines,
  resolve,
  type Finding,
} from "./markdown.js";
import { visionProblems } from "./vision-problems.js";

export const INDEX = "docs/index.md";
const CLI = "tools/kore/src/cli/cli.ts";
export const PLAN = /^infra\/plans\/[^/]+\.md$/;
export const ADR = /^docs\/decisions\/[^/]+\.md$/;
const IDEA = /^docs\/ideas\/[^/]+\.md$/;
const SKILL = /^skills\/[^/]+\/SKILL\.md$/;
export const MARKER =
  /^\s*(?:\/\/|#|\*|--|<!--)\s*(Docs|Plan|ADR):\s+([^\s#]+)(?:#(\S+))?/;

/** The tree the checks read: tracked paths and their contents (null when unreadable). */
export interface TreeDeps extends CommandDeps {
  files(): readonly string[];
  read(path: string): string | null;
}

/** What every check pass shares: the sorted tracked files and how to look a path or an anchor up. */
interface Tree {
  deps: TreeDeps;
  files: string[];
  tracked: Set<string>;
  exists(path: string): boolean;
  anchorProblem(
    file: string,
    line: number,
    label: string,
    target: string,
    anchor: string,
  ): Finding | null;
}

function openTree(deps: TreeDeps): Tree {
  const files = [...deps.files()].sort();
  const tracked = new Set(files);
  const anchorCache = new Map<string, string[]>();
  const anchorsOf = (path: string) => {
    let known = anchorCache.get(path);
    if (!known) {
      known = anchors(deps.read(path) ?? "");
      anchorCache.set(path, known);
    }
    return known;
  };
  return {
    deps,
    files,
    tracked,
    exists: (path) =>
      tracked.has(path) ||
      path === "." ||
      files.some((file) => file.startsWith(`${path}/`)),
    anchorProblem(file, line, label, target, anchor) {
      if (!target.endsWith(".md") || !tracked.has(target)) {
        return null;
      }
      const known = anchorsOf(target);
      if (known.includes(anchor.toLowerCase())) {
        return null;
      }
      return finding(
        file,
        line,
        `${label} #${anchor} is not a heading in ${target}`,
        known.length
          ? `use one of its heading slugs, e.g. #${known[0]}`
          : "remove the anchor; the file has no headings",
      );
    },
  };
}

/** Problems with the relative links in one Markdown file. */
function linkProblems(tree: Tree, file: string, text: string): Finding[] {
  const problems: Finding[] = [];
  for (const { line, text: prose } of proseLines(text)) {
    for (const [, raw = ""] of prose.matchAll(LINK)) {
      if (isExternal(raw)) {
        continue;
      }
      const [pathPart = "", anchor] = raw.split("#", 2);
      const target = pathPart ? resolve(file, decodeURI(pathPart)) : file;
      if (target === null || !tree.exists(target)) {
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
      const problem = anchor
        ? tree.anchorProblem(file, line, "link anchor", target, anchor)
        : null;
      if (problem) {
        problems.push(problem);
      }
    }
  }
  return problems;
}

/** Link and frontmatter problems across every Markdown file. */
function markdownProblems(tree: Tree, ideas: Map<string, string>): Finding[] {
  const problems: Finding[] = [];
  for (const file of tree.files.filter((name) => name.endsWith(".md"))) {
    const text = tree.deps.read(file);
    if (text === null) {
      continue;
    }
    problems.push(...linkProblems(tree, file, text));
    if (PLAN.test(file) || ADR.test(file)) {
      problems.push(
        ...checkFrontmatter(file, text, (path) => tree.exists(path)),
      );
    } else if (IDEA.test(file)) {
      problems.push(...checkIdea(file, text, ideas, flowMetricNames()));
    }
  }
  return problems;
}

/** Index entries that name a missing file, then plans, ADRs, ideas and skills the index omits. */
function indexProblems(tree: Tree): Finding[] {
  const index = tree.tracked.has(INDEX) ? tree.deps.read(INDEX) : null;
  if (index === null) {
    return [
      finding(
        INDEX,
        1,
        "the knowledge index is missing",
        "create it with one entry per plan, ADR, and skill",
      ),
    ];
  }
  const problems: Finding[] = [];
  const listed = new Set<string>();
  for (const { line, text } of proseLines(index)) {
    if (!text.startsWith("- [")) {
      continue;
    }
    const raw = /\]\(([^)\s#]+)/.exec(text)?.[1];
    if (raw === undefined || isExternal(raw)) {
      continue;
    }
    const target = resolve(INDEX, decodeURI(raw));
    if (target) {
      listed.add(target);
    }
    if (target === null || !tree.exists(target)) {
      problems.push(
        finding(
          INDEX,
          line,
          `index entry ${target ?? raw} names a missing file`,
          "remove the entry or restore the file",
        ),
      );
    }
  }
  for (const file of tree.files) {
    const indexed =
      PLAN.test(file) || ADR.test(file) || IDEA.test(file) || SKILL.test(file);
    if (indexed && !listed.has(file)) {
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
  return problems;
}

const TRAILING = /[.,;:)]+$/;

/** Docs:, Plan: and ADR: markers in code comments whose path or anchor does not resolve. */
function markerProblems(tree: Tree): Finding[] {
  const problems: Finding[] = [];
  for (const file of tree.files.filter((name) => !name.endsWith(".md"))) {
    const text = tree.deps.read(file);
    if (text === null) {
      continue;
    }
    text.split("\n").forEach((line, position) => {
      const match = MARKER.exec(line);
      if (!match) {
        return;
      }
      const [, label = "", rawPath = "", anchor] = match;
      const path = rawPath.replace(TRAILING, "");
      if (!tree.exists(path)) {
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
      const problem = anchor
        ? tree.anchorProblem(
            file,
            position + 1,
            `${label}: anchor`,
            path,
            anchor.replace(TRAILING, ""),
          )
        : null;
      if (problem) {
        problems.push(problem);
      }
    });
  }
  return problems;
}

/** Top-level `kore` commands in the CLI usage text that README.md does not mention. */
function readmeProblems(tree: Tree): Finding[] {
  const cli = tree.tracked.has(CLI) ? tree.deps.read(CLI) : null;
  const readme = tree.tracked.has("README.md")
    ? tree.deps.read("README.md")
    : null;
  const problems: Finding[] = [];
  if (cli === null || readme === null) {
    return problems;
  }
  const seen = new Set<string>();
  let inUsage = false;
  cli.split("\n").forEach((line, position) => {
    if (/^\s*Usage:\s*$/.test(line)) {
      inUsage = true;
      return;
    }
    if (!inUsage) {
      return;
    }
    if (!line.trim()) {
      inUsage = false;
      return;
    }
    const command = /^\s+kore\s+([a-z][\w-]*)/.exec(line)?.[1];
    if (!command || seen.has(command)) {
      return;
    }
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
  return problems;
}

/** Every knowledge-base problem in the tree, each with file, line, message, and fix. */
export function findings(deps: TreeDeps): Finding[] {
  const tree = openTree(deps);
  const { ideas, problems } = ideaNumbers(tree.files);
  return [
    ...problems,
    ...markdownProblems(tree, ideas),
    ...commandFindings(tree.deps, tree.files),
    ...indexProblems(tree),
    ...markerProblems(tree),
    ...readmeProblems(tree),
    ...visionProblems(tree.files, (path) => tree.deps.read(path)),
  ];
}
