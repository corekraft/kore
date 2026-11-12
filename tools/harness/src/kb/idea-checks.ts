// Frontmatter checks for idea records (ADR 0079).
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { DATE, finding, frontmatter, type Finding } from "./markdown.js";

export const IDEA_NAME = /^docs\/ideas\/(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

const IDEA_REQUIRED = [
  "summary",
  "hypothesis",
  "expected-outcome",
  "measurement",
  "safety-pattern",
  "date",
];
const IDEA_OUTCOMES = ["confirmed", "refuted", "inconclusive"];
const SAFETY_PATTERNS = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
  "expand-contract",
];
// The GitHub issue owns workflow state (open or closed included); an idea is closed when it has an outcome, and its file never stores state.
const WORKFLOW_KEYS = [
  "status",
  "approval",
  "approved",
  "approved-by",
  "label",
  "labels",
  "assignee",
  "assignees",
  "state",
];

type Keys = Map<string, { value: string; line: number }>;

/** A problem on the line of `key`'s frontmatter entry. */
const onKey = (
  file: string,
  keys: Keys,
  key: string,
  message: string,
  fix: string,
): Finding => finding(file, keys.get(key)?.line ?? 1, message, fix);

/** Values that are not allowed: the enumerations, the date, workflow state, and the issue link. */
function valueProblems(file: string, keys: Keys): Finding[] {
  const problems: Finding[] = [];
  const bad = (key: string, message: string, fix: string) =>
    problems.push(onKey(file, keys, key, message, fix));
  const oneOf = (key: string, allowed: string[]) => {
    const entry = keys.get(key);
    if (entry && !allowed.includes(entry.value)) {
      bad(
        key,
        `frontmatter ${key} is ${entry.value}`,
        `use one of ${allowed.join(", ")}`,
      );
    }
  };
  oneOf("safety-pattern", SAFETY_PATTERNS);
  oneOf("outcome", IDEA_OUTCOMES);
  const date = keys.get("date");
  if (date && !DATE.test(date.value)) {
    bad("date", `frontmatter date is ${date.value}`, "use a YYYY-MM-DD date");
  }
  for (const key of WORKFLOW_KEYS.filter((name) => keys.has(name))) {
    bad(
      key,
      `frontmatter ${key} is workflow state`,
      "the GitHub issue owns it, so remove the line",
    );
  }
  const issue = keys.get("issue");
  if (issue && !/^#?\d+$|^https:\/\/\S+$/.test(issue.value)) {
    bad(
      "issue",
      `frontmatter issue is ${issue.value}`,
      "use an issue number such as 185 or #185, or its URL",
    );
  }
  return problems;
}

/** A parent that is neither an issue nor an existing idea. */
function parentProblems(
  file: string,
  keys: Keys,
  ideas: ReadonlyMap<string, string>,
): Finding[] {
  const parent = keys.get("parent");
  if (!parent || /^#\d+$/.test(parent.value)) {
    return [];
  }
  const number = /^(\d{4})(?:-[a-z0-9-]+)?$/.exec(parent.value)?.[1];
  if (number === undefined) {
    return [
      onKey(
        file,
        keys,
        "parent",
        `frontmatter parent is ${parent.value}`,
        "use an idea number such as 0001, or an issue such as #127",
      ),
    ];
  }
  return ideas.has(number)
    ? []
    : [
        onKey(
          file,
          keys,
          "parent",
          `frontmatter parent is ${parent.value}; idea ${number} does not exist`,
          "use an existing idea's number or an issue such as #127",
        ),
      ];
}

/** The outcome line and the ## Outcome section must come together. */
function outcomeProblems(
  file: string,
  markdown: string,
  keys: Keys,
): Finding[] {
  const heading = markdown
    .split("\n")
    .findIndex((l) => /^## Outcome\s*$/.test(l));
  const outcome = keys.get("outcome");
  if (outcome && heading === -1) {
    return [
      onKey(
        file,
        keys,
        "outcome",
        "frontmatter outcome has no ## Outcome section",
        "run `harness outcome record --idea " +
          `${Number(IDEA_NAME.exec(file)?.[1] ?? 0)}\`, or remove the line`,
      ),
    ];
  }
  if (!outcome && heading !== -1) {
    return [
      finding(
        file,
        heading + 1,
        "## Outcome section has no frontmatter outcome line",
        "the outcome tool writes both; run `harness outcome record`, or remove the section",
      ),
    ];
  }
  return [];
}

/** Frontmatter problems of one idea record; `ideas` holds the numbers of every idea file. */
export function checkIdea(
  file: string,
  markdown: string,
  ideas: ReadonlyMap<string, string>,
): Finding[] {
  const parsed = frontmatter(file, markdown);
  if (!parsed) {
    return [
      finding(
        file,
        1,
        "frontmatter is missing",
        `start the file with --- and the idea fields (${IDEA_REQUIRED.join(", ")}) ---`,
      ),
    ];
  }
  const { keys } = parsed;
  const problems = [
    ...parsed.errors,
    ...valueProblems(file, keys),
    ...parentProblems(file, keys, ideas),
    ...outcomeProblems(file, markdown, keys),
  ];
  if (!IDEA_NAME.test(file)) {
    problems.push(
      finding(
        file,
        1,
        "idea file is not named NNNN-slug.md",
        "rename it to a four-digit number and a lowercase slug",
      ),
    );
  }
  problems.sort((a, b) => a.line - b.line);
  for (const key of IDEA_REQUIRED.filter((name) => !keys.has(name))) {
    problems.push(
      finding(file, 1, `frontmatter ${key} is missing`, `add a ${key}: line`),
    );
  }
  return problems;
}
