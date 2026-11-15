// Runs typecheck, lint and the related unit tests for the files given, by hand.
// Usage: mise run test-related <files>   (paths from the repository root)
// The commit hook's related-tests.mjs picks the tests, so one script owns that
// logic. Nothing here starts a cluster or an integration run (ADR 0098).
// Docs: docs/guides/contributor.md (Commit hooks)

import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "./related-tests.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGES = [
  { name: "kore", dir: "tools/kore" },
  { name: "harness", dir: "tools/harness" },
];

/** The npm steps to run for these repository-relative files, in order. */
export function commands(files) {
  const steps = [];
  for (const { name, dir } of PACKAGES) {
    const { mode, files: related } = plan(name, files);
    const touched = files.some((f) => f.startsWith(`${dir}/`));
    if (!touched && mode === "none") {
      continue;
    }
    steps.push(
      { cwd: dir, args: ["run", "check", "--silent"] },
      { cwd: dir, args: ["run", "lint", "--silent"] },
    );
    if (mode === "full") {
      steps.push({ cwd: dir, args: ["run", "test:unit", "--silent"] });
    } else if (mode === "related") {
      steps.push({
        cwd: dir,
        args: ["run", "test:related", "--silent", "--", ...related],
      });
    }
  }
  return steps;
}

/** Runs each step, stopping at the first failure; returns the exit code. */
export function run(files, exec = spawnSync) {
  for (const step of commands(files)) {
    const result = exec("npm", step.args, {
      cwd: join(root, step.cwd),
      stdio: "inherit",
    });
    if (result.status !== 0) {
      process.stderr.write(
        `test-related: \`npm ${step.args.join(" ")}\` failed in ${step.cwd}; fix it and rerun\n`,
      );
      return result.status ?? 1;
    }
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv
    .slice(2)
    .map((f) => relative(root, resolve(f)))
    .filter((f) => !f.startsWith(".."));
  if (files.length === 0) {
    process.stderr.write(
      "test-related: name the changed files, for example `mise run test-related tools/kore/src/cli/flags.ts`\n",
    );
    process.exit(2);
  }
  process.exit(run(files));
}
