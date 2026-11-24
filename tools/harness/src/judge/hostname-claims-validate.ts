// Runs kore validate over the merge of main and the PR, and reports the messages only the
// merge raises. The harness never imports tools/kore/src (ADR 0082): the claim rules run in
// kore's own CLI, which the judge's checkout builds. Validate needs a whole repository, so the
// check works in a scratch clone: main at its commit, then the PR's changed files at its head
// (a file the PR changes is the merge's version; a file it does not change is main's). Each
// environment is validated at main and at the merge, and a message is a refusal only when
// main does not raise it too.
// Docs: docs/decisions/0159-services-attach-to-the-platform-gateways-through-listener-sets-and-hostname-claims.md

import type { Dirent } from "node:fs";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../runtime/index.js";
import type { ChangedFile } from "./diff.js";
import { JudgeError } from "./errors.js";

/** The built kore CLI, relative to the judge's checkout. */
export const KORE_CLI = "tools/kore/dist/src/cli/cli.js";

export interface ClaimRun {
  runner: Runner;
  /** The judge's checkout: its origin is the repository, and its build holds the kore CLI. */
  root: string;
  mainSha: string;
  headSha: string;
  files: readonly ChangedFile[];
}

/** Whether the judge's checkout has the built kore CLI. */
export async function cliBuilt(root: string): Promise<boolean> {
  try {
    await access(join(root, KORE_CLI));
    return true;
  } catch {
    return false;
  }
}

async function git(
  runner: Runner,
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const done = await runner.run("git", args, { cwd });
  if (done.code !== 0) {
    throw new JudgeError(
      `git ${args[0]} failed in the hostname claim check: ${done.stderr.trim()}. Check that the judge's checkout has an origin remote that the machine can reach, then rerun the precheck.`,
    );
  }
  return done.stdout;
}

/** The messages kore validate prints for one environment on stderr; empty when it passes. */
async function validateOne(
  runner: Runner,
  scratch: string,
  cli: string,
  environment: string,
  mainSha: string,
): Promise<string[]> {
  const done = await runner.run(
    "node",
    [
      cli,
      "validate",
      "--environment",
      environment,
      "--record-base",
      mainSha,
      "--json",
    ],
    { cwd: scratch },
  );
  if (done.code === 0) {
    return [];
  }
  const messages = done.stderr
    .split("\n")
    .map((line) => line.replace(/^error: /, "").trim())
    .filter((line) => line !== "" && !line.startsWith("warning:"));
  return messages.length > 0
    ? messages
    : [
        `kore validate failed for environment ${environment} with no message: fix it on main, then rerun the precheck`,
      ];
}

/** The environments the scratch checkout holds, each with its validate messages. */
async function validateAll(
  runner: Runner,
  scratch: string,
  cli: string,
  environments: readonly string[],
  mainSha: string,
): Promise<Map<string, string[]>> {
  const results = new Map<string, string[]>();
  for (const environment of environments) {
    results.set(
      environment,
      await validateOne(runner, scratch, cli, environment, mainSha),
    );
  }
  return results;
}

/** The environments of a checkout that have an overlay: the ones validate can check. */
async function environmentsIn(scratch: string): Promise<string[]> {
  const directory = join(scratch, "infra/environments");
  let entries: Dirent[] = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        try {
          await access(join(directory, name, "environment.yaml"));
          return name;
        } catch {
          return undefined;
        }
      }),
  );
  return found.filter((name): name is string => name !== undefined);
}

/** The repository paths the PR changes, and the old path of each rename. */
const pathsOf = (files: readonly ChangedFile[]) => ({
  present: files.filter((f) => !f.deleted).map((f) => f.path),
  removed: files.flatMap((f) => [
    ...(f.deleted ? [f.path] : []),
    ...(f.previousPath === f.path ? [] : [f.previousPath]),
  ]),
});

/**
 * The messages the PR's merge with main raises in some environment and main does not. A
 * scratch checkout is removed whatever happens. Throws when git or validate cannot run.
 */
export async function validateRefusals(run: ClaimRun): Promise<string[]> {
  const { runner, root, mainSha, headSha, files } = run;
  const cli = join(root, KORE_CLI);
  const origin = (
    await git(runner, root, ["remote", "get-url", "origin"])
  ).trim();
  const scratch = await mkdtemp(join(tmpdir(), "kore-claims-"));
  try {
    await git(runner, scratch, ["init", "--quiet"]);
    await git(runner, scratch, ["remote", "add", "origin", origin]);
    await git(runner, scratch, [
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "origin",
      mainSha,
    ]);
    await git(runner, scratch, [
      "checkout",
      "--quiet",
      "--detach",
      "FETCH_HEAD",
    ]);
    const before = await validateAll(
      runner,
      scratch,
      cli,
      await environmentsIn(scratch),
      mainSha,
    );
    await git(runner, scratch, [
      "fetch",
      "--quiet",
      "--depth",
      "1",
      "origin",
      headSha,
    ]);
    const changed = pathsOf(files);
    for (const path of changed.removed) {
      await rm(join(scratch, path), { force: true });
    }
    if (changed.present.length > 0) {
      await git(runner, scratch, [
        "checkout",
        headSha,
        "--",
        ...changed.present,
      ]);
    }
    const after = await validateAll(
      runner,
      scratch,
      cli,
      await environmentsIn(scratch),
      mainSha,
    );
    return [...after].flatMap(([environment, messages]) => {
      const onMain = new Set(before.get(environment) ?? []);
      return messages.filter((message) => !onMain.has(message));
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
