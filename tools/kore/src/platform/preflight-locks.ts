import { readFile } from "node:fs/promises";
import { describeSigners, isReleaseLock } from "./release-lock.js";
import { reasonOf, type MissingPrerequisite } from "./preflight-message.js";

// Docs: docs/decisions/0147-vps-v1-is-every-applicable-flag-proven-live-one-per-run-from-release-locks.md

/** The two release locks a managed environment takes, each named as the run's flag and file. */
interface LockKind {
  name: string;
  flag: string;
  file: string;
}

const chartLock: LockKind = {
  name: "release chart lock",
  flag: "--platform-chart-lock",
  file: "platform-charts.lock.json",
};
const imageLock: LockKind = {
  name: "release image lock",
  flag: "--platform-template-lock",
  file: "template-images.lock.json",
};

/** The one missing or refused lock, or undefined when it is a release lock that reads. */
async function lockProblem(
  kind: LockKind,
  path: string | undefined,
): Promise<MissingPrerequisite | undefined> {
  const fix = `pass the ${kind.file} attached to the release`;
  if (path === undefined) {
    return { name: kind.name, problem: `${kind.flag} is not given`, fix };
  }
  let lock: unknown;
  try {
    lock = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    // An expected failure here: the file is absent or is not JSON. Named, not thrown,
    // so the preflight lists it with the others.
    return {
      name: kind.name,
      problem: `${kind.flag} ${path} is not readable as ${kind.file}: ${reasonOf(error)}`,
      fix,
    };
  }
  if (isReleaseLock(lock)) {
    return undefined;
  }
  return {
    name: kind.name,
    problem: `${kind.flag} ${path} is signed by ${describeSigners(lock)}, not by release automation at a version tag`,
    fix: `${fix}; a main lock serves a local proof only`,
  };
}

/**
 * The release chart lock and the release image lock a managed environment
 * requires, each read once: a missing, unreadable or non-release lock is named
 * with its fix. Both are checked whether or not a run installs from them, since
 * ADR 0147 names both as prerequisites. Reads the two files and nothing else.
 */
export async function lockProblems(locks: {
  chartLock: string | undefined;
  templateLock: string | undefined;
}): Promise<MissingPrerequisite[]> {
  const problems: MissingPrerequisite[] = [];
  for (const [kind, path] of [
    [chartLock, locks.chartLock],
    [imageLock, locks.templateLock],
  ] as const) {
    const problem = await lockProblem(kind, path);
    if (problem !== undefined) {
      problems.push(problem);
    }
  }
  return problems;
}
