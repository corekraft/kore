// The organization immutability check's git side (ADR 0166): the base ref is read
// with git through the injected runner, and nothing outside the repository is read.
// Docs: docs/decisions/0166-an-app-is-a-service-with-a-two-file-record-in-kore-and-its-source-in-its-own-repository.md

import type { Runner } from "../runtime/index.js";
import { organizationChangeErrors } from "./app-record-rules.js";

/** The base ref the immutability check compares against, unless --record-base names another. */
export const defaultRecordBase = "origin/main";

/** A spec file whose organization the check compares. */
export interface ImmutabilityRecord {
  /** The service name, the file name without .json. */
  stem: string;
  /** The spec file, as a repository path. */
  file: string;
  /** The organization in the working tree. */
  organization: string;
}

export interface ImmutabilityCheck {
  root: string;
  runner: Runner;
  /** The --record-base ref; unset compares against origin/main. */
  recordBase?: string | undefined;
  records: readonly ImmutabilityRecord[];
}

export interface ImmutabilityReport {
  errors: string[];
  warnings: string[];
}

async function resolves(
  runner: Runner,
  root: string,
  ref: string,
): Promise<boolean> {
  try {
    await runner.run(
      "git",
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      { capture: true, cwd: root },
    );
    return true;
  } catch {
    return false;
  }
}

/** The text of a file at a base ref, or undefined when the file is absent there. */
async function baseText(
  runner: Runner,
  root: string,
  ref: string,
  file: string,
): Promise<string | undefined> {
  try {
    return (
      await runner.run("git", ["show", `${ref}:${file}`], {
        capture: true,
        cwd: root,
      })
    ).stdout;
  } catch {
    return undefined;
  }
}

/** The organization of a base copy; a copy that is not strict JSON has none to compare. */
function baseOrganization(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    const spec: unknown = (JSON.parse(text) as { spec?: unknown }).spec;
    const organization =
      typeof spec === "object" && spec !== null
        ? (spec as { organization?: unknown }).organization
        : undefined;
    return typeof organization === "string" ? organization : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The organization immutability check (ADR 0166). An explicit base that does not
 * resolve fails; the default base that does not resolve is a warning, so a
 * checkout without git or origin still runs. A service absent at the base is new.
 */
export async function immutabilityReport(
  check: ImmutabilityCheck,
): Promise<ImmutabilityReport> {
  const { root, runner, recordBase, records } = check;
  const ref = recordBase ?? defaultRecordBase;
  if (!(await resolves(runner, root, ref))) {
    return recordBase !== undefined
      ? {
          errors: [
            `--record-base ${recordBase} does not resolve to a commit; name a commit that exists in this repository, or drop the flag to compare against ${defaultRecordBase}`,
          ],
          warnings: [],
        }
      : {
          errors: [],
          warnings: [
            `the organization immutability check was not run: ${defaultRecordBase} does not resolve (no git or no origin); pass --record-base <ref> to compare against another ref`,
          ],
        };
  }
  const errors: string[] = [];
  for (const record of records) {
    const base = baseOrganization(
      await baseText(runner, root, ref, record.file),
    );
    errors.push(
      ...organizationChangeErrors({
        file: record.file,
        name: record.stem,
        base,
        current: record.organization,
        ref,
      }),
    );
  }
  return { errors, warnings: [] };
}
