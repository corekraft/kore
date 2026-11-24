import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { featureEnabled } from "./features.js";
import type { Environment } from "./types.js";

// Docs: docs/decisions/0164-the-platform-domain-is-a-run-time-value-and-the-repository-holds-a-placeholder.md

/**
 * The public facts the repository never holds (ADR 0164). Each is an
 * environment variable, which overrides the owner-only run-time file on the
 * machine. The platform domain has its own variable, read by platformPlan().
 */
export const runTimeVariables = {
  publicIPv4: "KORE_PUBLIC_IPV4",
  cloudflareZoneId: "KORE_CLOUDFLARE_ZONE_ID",
  tailnetAddress: "KORE_TAILNET_ADDRESS",
} as const;
export type RunTimeName =
  (typeof runTimeVariables)[keyof typeof runTimeVariables];

/** A run-time value a flag needs while the flag is on. */
export interface RunTimeNeed {
  flag: string;
  name: RunTimeName;
}

/**
 * The run-time values each flag needs while it is on. Empty until the flag
 * tickets that consume a value add their needs, so doctor lists none yet.
 */
export const runTimeNeeds: Readonly<Record<string, readonly RunTimeName[]>> =
  {};

/** A run-time file that cannot be used, named by its path and the fix. */
export class RunTimeFileError extends Error {}

/** The owner-only file under the machine's kore home, never inside the repository. */
export function runTimeFilePath(home: string): string {
  return join(home, ".kore", "runtime.env");
}

/** The file as read: its path, its permission bits and its text. */
export interface RunTimeFile {
  path: string;
  mode: number;
  text: string;
}

const assignment = /^([A-Z][A-Z0-9_]*)=(.*)$/;

/**
 * The values a file holds, one NAME=value per line; blank lines and # comments
 * are skipped. A malformed line is refused by its number, never by its text.
 */
export function parseRunTimeFile(
  text: string,
  path: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      return;
    }
    const match = assignment.exec(line);
    if (match === null) {
      throw new RunTimeFileError(
        `${path} line ${index + 1} is not NAME=value; fix that line`,
      );
    }
    const [, name = "", value = ""] = match;
    values[name] = value.trim();
  });
  return values;
}

const othersBits = 0o077;

/**
 * The file's values, read only when no one but its owner can read the file. No
 * file is no values, and that is not an error.
 */
export function runTimeValues(
  file: RunTimeFile | undefined,
): Record<string, string> {
  if (file === undefined) {
    return {};
  }
  if ((file.mode & othersBits) !== 0) {
    throw new RunTimeFileError(
      `${file.path} is readable by others; run chmod 600 ${file.path}, then retry`,
    );
  }
  return parseRunTimeFile(file.text, file.path);
}

/** The two reads the loader makes: the file's mode and its text. The machine reads them from disk; a spec passes its own. */
export type RunTimeReads = {
  stat(path: string): Promise<{ mode: number }>;
  readFile(path: string): Promise<string>;
};

const machineReads: RunTimeReads = {
  stat: (path) => stat(path),
  readFile: (path) => readFile(path, "utf8"),
};

/** The file at a path, or undefined when there is none; other read failures are rethrown. */
export async function loadRunTimeFile(
  path: string,
  reads: RunTimeReads = machineReads,
): Promise<RunTimeFile | undefined> {
  try {
    const [info, text] = await Promise.all([
      reads.stat(path),
      reads.readFile(path),
    ]);
    return { path, mode: info.mode & 0o777, text };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** The environment variable's value, or the file's when the variable is unset or empty. */
export function runTimeValue(
  name: RunTimeName,
  env: NodeJS.ProcessEnv,
  values: Readonly<Record<string, string>>,
): string | undefined {
  return env[name] || values[name] || undefined;
}

/** Each run-time value a flag that is on needs, in flag order. */
export function runTimeNeededBy(
  environment: Pick<Environment, "features">,
  needs: Readonly<Record<string, readonly RunTimeName[]>> = runTimeNeeds,
): RunTimeNeed[] {
  return Object.entries(needs)
    .filter(([flag]) => featureEnabled(environment, flag))
    .flatMap(([flag, names]) => names.map((name) => ({ flag, name })));
}

/** The needs that neither the environment nor the file supplies. */
export function missingRunTimeValues(
  needed: readonly RunTimeNeed[],
  env: NodeJS.ProcessEnv,
  values: Readonly<Record<string, string>>,
): RunTimeNeed[] {
  return needed.filter(
    ({ name }) => runTimeValue(name, env, values) === undefined,
  );
}
