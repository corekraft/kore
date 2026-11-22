import { isAbsolute, join, relative, sep } from "node:path";
import { CommandError } from "../runtime/index.js";
import type { FileSystem, Links } from "../runtime/index.js";

/** Where a session's report lives: under the checkout its terminal was launched in. */
export const REPORT_DIR = ".kore/report";

/** One report file, as session report writes it. A rising seq tells a rework's report from the one before it. */
export interface Report {
  seq: number;
  outcome: "done" | "blocked";
  summary: string;
  at: string;
  /** The text of the plan file, when the session named one. */
  plan?: string;
}

export function reportDirOf(cwd: string): string {
  return join(cwd, REPORT_DIR);
}

export function reportPath(cwd: string, name: string): string {
  return join(reportDirOf(cwd), `${name}.json`);
}

/** True when an absolute path is strictly inside `dir`, judged by its text alone. */
function isStrictlyInside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel);
}

/**
 * True for an absolute path that is a file inside the report directory. The path must sit inside the
 * directory as written, and, when it exists, its real location (every link followed) must sit inside the
 * directory's real location, so a link in the report directory cannot reach outside it.
 */
export async function isInsideReportDir(
  fs: Pick<FileSystem, "exists">,
  links: Links | undefined,
  cwd: string,
  path: string,
): Promise<boolean> {
  const dir = reportDirOf(cwd);
  if (!isStrictlyInside(dir, path)) {
    return false;
  }
  if (!(await fs.exists(path))) {
    return true;
  }
  if (links === undefined) {
    return false;
  }
  const [realDir, realPath] = await Promise.all([
    links.realpath(dir),
    links.realpath(path),
  ]);
  return isStrictlyInside(realDir, realPath);
}

function isReport(value: unknown): value is Report {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { seq, outcome, summary, at, plan } = value as Partial<
    Record<keyof Report, unknown>
  >;
  return (
    typeof seq === "number" &&
    Number.isInteger(seq) &&
    seq >= 1 &&
    (outcome === "done" || outcome === "blocked") &&
    typeof summary === "string" &&
    typeof at === "string" &&
    (plan === undefined || typeof plan === "string")
  );
}

/** The report the file holds, or undefined when there is none yet. A file that is not a report is refused, naming it. */
export async function readReport(
  fs: Pick<FileSystem, "exists" | "readFile">,
  path: string,
): Promise<Report | undefined> {
  if (!(await fs.exists(path))) {
    return undefined;
  }
  const text = await fs.readFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (!isReport(parsed)) {
    throw new CommandError(
      `Report ${path} is not a valid session report; delete it and run session report again.`,
    );
  }
  return parsed;
}

/** The fixed one-line notice a parent receives: the name, outcome, seq and report path, never the summary. */
export function noticeLine(
  name: string,
  outcome: Report["outcome"],
  seq: number,
  path: string,
): string {
  return `${name} ${outcome} seq ${seq}: ${path}`;
}
