// Skill links: report any skill (a `skills/` directory with a SKILL.md) in `skills/` that a harness directory does not
// link by its relative path. Plan: infra/plans/3-agent-harness.md (Step 9).
// Node standard library only.

import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const HARNESSES = [".claude", ".codex"];

/** Problems with the skill links under root, each with its fix; empty when all are correct. */
export function linkProblems(root) {
  const skills = readdirSync(join(root, "skills"), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(root, "skills", entry.name, "SKILL.md")),
    )
    .map((entry) => entry.name)
    .sort();
  const problems = [];
  for (const harness of HARNESSES) {
    for (const skill of skills) {
      const link = `${harness}/skills/${skill}`;
      const expected = `../../skills/${skill}`;
      let target;
      try {
        target = readlinkSync(join(root, link));
      } catch (error) {
        if (error?.code === "EINVAL") {
          problems.push(
            `${link} is a directory or file, not a link; replace it with a link to ${expected}`,
          );
          continue;
        }
        if (error?.code !== "ENOENT") throw error;
        problems.push(`${link} is missing; link it to ${expected}`);
        continue;
      }
      if (isAbsolute(target)) {
        problems.push(
          `${link} links to an absolute path; relink it to ${expected}`,
        );
      } else if (target !== expected) {
        problems.push(`${link} links to ${target}; relink it to ${expected}`);
      }
    }
  }
  return problems;
}
