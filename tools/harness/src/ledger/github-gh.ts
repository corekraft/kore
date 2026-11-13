import type { Runner } from "../runtime/index.js";
import { RATE_LIMITED, rateLimited } from "./github-poll.js";
import { isTimestamp } from "./schema.js";

export type Raw = Record<string, unknown>;

/** Runs and pull requests one `gh` listing returns; a full listing may be missing some. */
export const LIMIT = 200;
export const PAGE = 100;
/** The commits, comments and events APIs: at most three pages of the newest. */
export const MAX_PAGES = 3;
export const DAY_MS = 86_400_000;

export const asRecord = (value: unknown): Raw =>
  typeof value === "object" && value !== null ? (value as Raw) : {};

export const when = (value: unknown): string | undefined =>
  typeof value === "string" && isTimestamp(value) ? value : undefined;

export const count = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) >= 1
    ? (value as number)
    : undefined;

const noop = () => Promise.resolve();

/** A failed `gh` call as a message: the rate limit with its retry time, else the cause. */
async function failure(
  runner: Runner,
  what: string,
  found: { code: number; stdout: string; stderr: string },
): Promise<string> {
  const text = `${found.stderr}${found.stdout}`.trim();
  if (RATE_LIMITED.test(text)) {
    return rateLimited({ runner, refresh: noop }, what);
  }
  return `gh ${what} failed: ${text === "" ? `exit code ${found.code}` : text}. Is gh installed and logged in (gh auth status)?`;
}

/** A `gh` call's JSON, or the message saying which call failed. */
export async function json(
  runner: Runner,
  what: string,
  args: string[],
): Promise<unknown> {
  const found = await runner.run("gh", args);
  if (found.code !== 0) {
    return await failure(runner, what, found);
  }
  try {
    return JSON.parse(found.stdout) as unknown;
  } catch {
    return `gh ${what} did not print JSON; the gh version may have changed its output.`;
  }
}

export async function list(
  runner: Runner,
  what: string,
  args: string[],
): Promise<Raw[] | string> {
  const value = await json(runner, what, args);
  if (Array.isArray(value)) {
    return value.map(asRecord);
  }
  if (typeof value === "string") {
    return value;
  }
  return `gh ${what} did not print a JSON list; the gh version may have changed its output.`;
}

/** Newest-first pages of a `gh api` listing, stopping at a short page or one that reaches `since`. */
export async function pages(
  runner: Runner,
  what: string,
  path: string,
  since?: string,
): Promise<Raw[] | string> {
  const all: Raw[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const got = await list(runner, what, [
      "api",
      `${path}${path.includes("?") ? "&" : "?"}per_page=${PAGE}&page=${page}`,
    ]);
    if (typeof got === "string") {
      return got;
    }
    all.push(...got);
    const last = got.at(-1) ?? {};
    const oldest = when(
      last["created_at"] ??
        asRecord(asRecord(last["commit"])["committer"])["date"],
    );
    const reached =
      since !== undefined &&
      oldest !== undefined &&
      Date.parse(oldest) <= Date.parse(since);
    if (got.length < PAGE || reached) {
      return all;
    }
  }
  return `gh ${what} had more than ${MAX_PAGES * PAGE} entries${since === undefined ? "" : ` since ${since}`}, so some would be missing. ${since === undefined ? "Pass --since with a later time" : "Poll more often"}.`;
}
