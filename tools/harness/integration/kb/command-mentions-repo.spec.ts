// The repository names no harness command or flag that does not exist, checked against the real command table.
// Docs: infra/plans/17-harness-help-guide.md#step-1-help-guide

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { domains } from "../../src/cli/index.js";
import { findings, format } from "../../src/kb/index.js";
import { cleanGitEnv } from "../../src/testing/index.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The files the check reads: Markdown, and the string literals of harness source (its specs excluded). */
const isChecked = (path: string) =>
  path.endsWith(".md") ||
  (path.startsWith("tools/harness/src/") &&
    path.endsWith(".ts") &&
    !path.endsWith(".spec.ts"));

it("the repository's current documents name only harness commands and flags that exist", () => {
  const listed = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: repo, encoding: "utf8", env: cleanGitEnv() },
  );
  const files = listed.stdout.split("\0").filter(Boolean);
  const problems = findings({
    files: () => files,
    read: (path) =>
      isChecked(path) ? readFileSync(resolve(repo, path), "utf8") : null,
    commands: () => domains,
  })
    .map(format)
    .filter((line) => /^\S+:\d+: harness /.test(line));
  expect(problems).toEqual([]);
});
