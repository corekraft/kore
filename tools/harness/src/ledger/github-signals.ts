import type { Clock, FileSystem, Runner } from "../runtime/index.js";
import type { GithubPollResult } from "./github-poll.js";
import type { Ledger } from "./ledger.js";
import { acquire } from "./poll-lock.js";
import { isTimestamp, type EventInput } from "./schema.js";

/**
 * The outcome signals agents do not write: how GitHub's own workflow runs
 * concluded (only runs GitHub started), which pull requests were titled as
 * reverts, and when the owner login acted. The last two are only as trusted as
 * the pull request title and the shared login (#336).
 * Only numbers, conclusions and times are kept: never a title, body or login.
 */

type Raw = Record<string, unknown>;

const WORKFLOWS = [
  // Only the runs GitHub starts itself: a run an agent dispatches or reruns by hand is not counted.
  { file: "check.yml", kind: "ci.main", branch: "main", event: "push" },
  { file: "nightly.yml", kind: "ci.nightly", event: "schedule" },
] as const;

const LIMIT = 200;
const PAGE = 100;
/** The comments and events APIs: at most three pages of the newest. */
const MAX_PAGES = 3;

const asRecord = (value: unknown): Raw =>
  typeof value === "object" && value !== null ? (value as Raw) : {};

const when = (value: unknown): string | undefined =>
  typeof value === "string" && isTimestamp(value) ? value : undefined;

const count = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) >= 1
    ? (value as number)
    : undefined;

/** A `gh` call's JSON list, or the message saying which call failed. */
async function list(
  runner: Runner,
  what: string,
  args: string[],
): Promise<Raw[] | string> {
  const found = await runner.run("gh", args);
  if (found.code !== 0) {
    const text = `${found.stderr}${found.stdout}`.trim();
    return `gh ${what} failed: ${text === "" ? `exit code ${found.code}` : text}. Is gh installed and logged in (gh auth status)?`;
  }
  try {
    const value = JSON.parse(found.stdout) as unknown;
    if (Array.isArray(value)) {
      return value.map(asRecord);
    }
  } catch {
    // Falls through to the message below.
  }
  return `gh ${what} did not print a JSON list; the gh version may have changed its output.`;
}

/** Success and failure only: a cancelled or skipped run says nothing about the code. */
const OUTCOME: Record<string, "success" | "failure" | undefined> = {
  success: "success",
  failure: "failure",
  timed_out: "failure",
};

function fromRuns(runs: Raw[], kind: "ci.main" | "ci.nightly"): EventInput[] {
  const out: EventInput[] = [];
  for (const raw of runs) {
    const id = count(raw["databaseId"]);
    const at = when(raw["updatedAt"]);
    const outcome = OUTCOME[String(raw["conclusion"])];
    if (id !== undefined && at !== undefined && outcome !== undefined) {
      out.push({
        id: `github:${kind}:${id}`,
        source: "github",
        kind,
        occurredAt: at,
        outcome,
      });
    }
  }
  return out;
}

const REVERT = /^revert\b/i;

function fromReverts(prs: Raw[]): EventInput[] {
  const out: EventInput[] = [];
  for (const raw of prs) {
    const number = count(raw["number"]);
    const at = when(raw["mergedAt"]);
    if (
      number !== undefined &&
      at !== undefined &&
      typeof raw["title"] === "string" &&
      REVERT.test(raw["title"])
    ) {
      out.push({
        id: `github:pr.reverted:${number}`,
        source: "github",
        kind: "pr.reverted",
        occurredAt: at,
        number,
      });
    }
  }
  return out;
}

const issueNumber = (url: unknown) =>
  count(Number(/\/issues\/(\d+)$/.exec(String(url))?.[1]));

function fromActions(
  comments: Raw[],
  events: Raw[],
  owner: string,
): EventInput[] {
  const out: EventInput[] = [];
  const add = (
    id: string,
    login: unknown,
    at: unknown,
    number: number | undefined,
  ) => {
    const time = when(at);
    if (login === owner && time !== undefined && number !== undefined) {
      out.push({
        id,
        source: "github",
        kind: "owner.action",
        occurredAt: time,
        number,
      });
    }
  };
  for (const c of comments) {
    add(
      `github:owner.action:comment:${String(c["id"])}`,
      asRecord(c["user"])["login"],
      c["created_at"],
      issueNumber(c["issue_url"]),
    );
  }
  for (const e of events) {
    add(
      `github:owner.action:event:${String(e["id"])}`,
      asRecord(e["actor"])["login"],
      e["created_at"],
      count(asRecord(e["issue"])["number"]),
    );
  }
  return out;
}

/** Newest-first pages of a `gh api` listing, stopping at a short page. */
async function pages(
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
    const oldest = when(got.at(-1)?.["created_at"]);
    const reached =
      since !== undefined &&
      oldest !== undefined &&
      Date.parse(oldest) <= Date.parse(since);
    if (got.length < PAGE || reached) {
      return all;
    }
  }
  // A full last page that never reached the last poll: some actions are missing.
  return since === undefined
    ? all
    : `gh ${what} had more than ${MAX_PAGES * PAGE} entries since ${since}, so some owner actions would be missing. Poll more often.`;
}

async function fetchPlanned(
  runner: Runner,
  repo: string,
  owner: string,
  since?: string,
): Promise<EventInput[] | string> {
  const planned: EventInput[] = [];
  for (const { file, kind, ...rest } of WORKFLOWS) {
    const runs = await list(runner, "run list", [
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      file,
      ...("branch" in rest ? ["--branch", rest.branch] : []),
      "--event",
      rest.event,
      "--status",
      "completed",
      "--limit",
      String(LIMIT),
      "--json",
      "databaseId,conclusion,updatedAt",
    ]);
    if (typeof runs === "string") {
      return runs;
    }
    planned.push(...fromRuns(runs, kind));
  }
  const prs = await list(runner, "pr list", [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "merged",
    "--search",
    "Revert in:title",
    "--limit",
    String(LIMIT),
    "--json",
    "number,title,mergedAt",
  ]);
  if (typeof prs === "string") {
    return prs;
  }
  planned.push(...fromReverts(prs));
  const comments = await pages(
    runner,
    "api issues/comments",
    `repos/${repo}/issues/comments?sort=created&direction=desc${since === undefined ? "" : `&since=${since}`}`,
    since,
  );
  if (typeof comments === "string") {
    return comments;
  }
  const events = await pages(
    runner,
    "api issues/events",
    `repos/${repo}/issues/events`,
    since,
  );
  if (typeof events === "string") {
    return events;
  }
  planned.push(...fromActions(comments, events, owner));
  return planned;
}

/**
 * Appends ci.main, ci.nightly, pr.reverted and owner.action events that the
 * ledger does not hold. Ids come from GitHub's own run, pull request, comment
 * and event ids, so re-polling appends nothing. `owner` is the one login whose
 * actions are kept.
 */
export async function pollSignals(deps: {
  ledger: Ledger;
  runner: Runner;
  clock: Clock;
  fs: FileSystem;
  repo: string;
  owner: string;
}): Promise<GithubPollResult> {
  const held = await acquire(
    deps.fs,
    deps.clock,
    `${deps.ledger.path}.signals.lock`,
  );
  if (!held.ok) {
    return { ok: false, message: held.message };
  }
  try {
    const { events: known } = await deps.ledger.list({ source: "github" });
    const have = new Set(known.map((e) => e.id));
    // Owner actions are paged back to the last one recorded; older ones were polled already.
    const since = known
      .filter((e) => e.kind === "owner.action")
      .map((e) => e.occurredAt)
      .sort()
      .at(-1);
    const fetched = await fetchPlanned(
      deps.runner,
      deps.repo,
      deps.owner,
      since,
    );
    if (typeof fetched === "string") {
      return { ok: false, message: fetched };
    }
    const planned = fetched
      .filter((e) => !have.has(e.id ?? ""))
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    for (const input of planned) {
      const result = await deps.ledger.record(input);
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
    }
    return { ok: true, recorded: planned.length, events: planned };
  } finally {
    await held.release();
  }
}
