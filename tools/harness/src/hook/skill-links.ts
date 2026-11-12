// Skill links: report any skill (a `skills/` directory with a SKILL.md) that a
// harness directory does not link by its relative path.
// Plan: infra/plans/3-agent-harness.md (Step 9).

import { isAbsolute, join } from "node:path";
import { CommandError, type FileSystem } from "../runtime/index.js";

const HARNESSES = [".claude", ".codex"];

async function skillNames(fs: FileSystem, root: string): Promise<string[]> {
  const entries = await fs.readdir(join(root, "skills"));
  const skills: string[] = [];
  for (const entry of entries) {
    if (await fs.exists(join(root, "skills", entry, "SKILL.md"))) {
      skills.push(entry);
    }
  }
  return skills.sort();
}

async function targetOf(
  fs: FileSystem,
  path: string,
): Promise<{ target: string } | { code: "EINVAL" | "ENOENT" }> {
  if (fs.readlink === undefined) {
    throw new CommandError(
      "This file system cannot read symbolic links; run the hook with the node file system, or give the injected one a readlink method.",
    );
  }
  try {
    return { target: await fs.readlink(path) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EINVAL" || code === "ENOENT") {
      return { code };
    }
    throw error;
  }
}

/** Problems with the skill links under root, each with its fix; empty when all are correct. */
export async function linkProblems(
  fs: FileSystem,
  root: string,
): Promise<string[]> {
  const skills = await skillNames(fs, root);
  const problems: string[] = [];
  for (const harness of HARNESSES) {
    for (const skill of skills) {
      const link = `${harness}/skills/${skill}`;
      const expected = `../../skills/${skill}`;
      const found = await targetOf(fs, join(root, link));
      if ("code" in found) {
        problems.push(
          found.code === "EINVAL"
            ? `${link} is a directory or file, not a link; replace it with a link to ${expected}`
            : `${link} is missing; link it to ${expected}`,
        );
      } else if (isAbsolute(found.target)) {
        problems.push(
          `${link} links to an absolute path; relink it to ${expected}`,
        );
      } else if (found.target !== expected) {
        problems.push(
          `${link} links to ${found.target}; relink it to ${expected}`,
        );
      }
    }
  }
  return problems;
}
