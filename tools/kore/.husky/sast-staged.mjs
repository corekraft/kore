// Picks the staged files the pre-commit SAST step scans.
// Usage: printf '%s\n' "$staged" | node sast-staged.mjs
// Prints one path per line. The scope mirrors the `scan-sast` mise task: the
// same roots, with tests and node_modules left out. Deleted paths are skipped.
// Docs: docs/guides/contributor.md (Commit hooks)

import { existsSync, readFileSync } from "node:fs";

export const ROOTS = [
  "tools/kore/src/",
  "tools/harness/src/",
  "apps/",
  ".claude/",
];

const SOURCE = /\.(ts|mjs|js)$/;
const TEST = /\.spec\.ts$|\.test\.(ts|mjs)$/;

export function selectScanned(paths) {
  return paths.filter(
    (path) =>
      SOURCE.test(path) &&
      !TEST.test(path) &&
      !path.split("/").includes("node_modules") &&
      ROOTS.some((root) => path.startsWith(root)),
  );
}

const staged = readFileSync(0, "utf8").split("\n").filter(Boolean);
for (const path of selectScanned(staged)) {
  if (existsSync(path)) console.log(path);
}
