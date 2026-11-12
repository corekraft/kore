// Frontmatter checks for plans and ADRs.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { DATE, finding, frontmatter, type Finding } from "./markdown.js";

const ADR = /^docs\/decisions\/[^/]+\.md$/;

type Keys = Map<string, { value: string; line: number }>;

/** Status and date values that are not allowed. */
function valueProblems(file: string, keys: Keys, adr: boolean): Finding[] {
  const problems: Finding[] = [];
  const statuses = adr
    ? ["proposed", "accepted", "superseded"]
    : ["active", "done"];
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
  return problems;
}

export function checkFrontmatter(
  file: string,
  markdown: string,
  exists: (path: string) => boolean,
): Finding[] {
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
  const required = adr
    ? ["status", "date", "summary", "last-verified"]
    : ["status", "summary", "last-verified"];
  const { keys } = parsed;
  if (adr && keys.get("status")?.value === "superseded") {
    required.push("superseded-by");
  }
  const problems = [...parsed.errors, ...valueProblems(file, keys, adr)];
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
