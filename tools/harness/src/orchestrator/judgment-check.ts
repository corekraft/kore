/** The most characters of one question or stop reason; a placeholder (ADR 0121). */
export const TEXT_MAX = 300;
/** The most characters of one work piece's brief; a placeholder (ADR 0121). */
export const BRIEF_MAX = 600;

export const SUFFIX =
  "The whole plan is refused and nothing was started; fix the judgment pane's plan and rerun.";

export type WorkRole = "writer" | "reader";

/** One question a judgment pane asks of Haiku readers, with the paths they may read. */
export interface ReadRequest {
  question: string;
  paths: string[];
}

/** One piece of work the tick spawns, which waits on the pieces named in `after`. */
export interface WorkPiece {
  role: WorkRole;
  name: string;
  brief: string;
  files: string[];
  after: string[];
}

/** A checked plan: exactly one of reads, work or stop. */
export type Plan =
  | { kind: "reads"; reads: ReadRequest[] }
  | { kind: "work"; work: WorkPiece[] }
  | { kind: "stop"; reason: string };

export type PlanCheck = { ok: true; plan: Plan } | Refusal;

/** A refused plan, with the message the tick reports. */
export type Refusal = { ok: false; error: string };

/** A refusal for the whole plan, ending with what the owner must do. */
export function refuse(problem: string): Refusal {
  return { ok: false, error: `${problem} ${SUFFIX}` };
}

/** A refusal naming the item and the field that is wrong. */
export function fieldRefusal(
  where: string,
  field: string,
  problem: string,
): Refusal {
  return refuse(`${where} has field ${field}: ${problem}.`);
}

/** The problem with a text field, or undefined when it is a non-empty string within the cap. */
export function textProblem(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return "give it a non-empty string";
  }
  return value.length > max
    ? `it is over ${max} characters; shorten it`
    : undefined;
}

/** The paths, each inside the repository, or the problem with the first one that is not. */
export function checkPaths(
  value: unknown,
): { ok: true; paths: string[] } | { ok: false; problem: string } {
  if (!Array.isArray(value)) {
    return { ok: false, problem: "give it a list of paths" };
  }
  for (const path of value) {
    if (typeof path !== "string" || path.trim() === "") {
      return { ok: false, problem: "give each path as a non-empty string" };
    }
    if (!insideRepository(path)) {
      return {
        ok: false,
        problem: `the path "${path}" is not inside the repository; use a path relative to the repository root`,
      };
    }
  }
  return { ok: true, paths: value.map((path) => String(path)) };
}

function insideRepository(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.startsWith("~") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.split("/").includes("..")
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first key of an object that the allowed list does not name. */
export function strayField(
  value: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  return Object.keys(value).find((key) => !allowed.includes(key));
}
