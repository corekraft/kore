import type { Clock, FileSystem, Runner } from "../runtime/index.js";
import { acquire } from "./poll-lock.js";
import type { Ledger } from "./ledger.js";
import { isTimestamp, type EventInput } from "./schema.js";

export type GithubPollResult =
  | { ok: true; recorded: number; events: EventInput[] }
  | { ok: false; message: string };

const LIMIT = 1000;

const describe = (code: number, stdout: string, stderr: string) => {
  const text = `${stderr}${stdout}`.trim();
  return text === "" ? `exit code ${code}` : `exit code ${code}: ${text}`;
};

/** What every `gh` query needs: the runner, and a hook to keep the poll's lock fresh. */
interface Gh {
  runner: Runner;
  refresh(): Promise<void>;
}

const RATE_LIMITED = /rate limit|HTTP 403|HTTP 429/i;

/** The ISO time the core rate limit resets, or undefined when gh cannot say. */
async function resetTime(gh: Gh): Promise<string | undefined> {
  const found = await gh.runner.run("gh", ["api", "rate_limit"]);
  try {
    const parsed = JSON.parse(found.stdout) as unknown;
    const core = asRecord(asRecord(asRecord(parsed)["resources"])["core"]);
    const reset = core["reset"];
    return typeof reset === "number" && Number.isFinite(reset)
      ? new Date(reset * 1000).toISOString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function rateLimited(gh: Gh, what: string): Promise<string> {
  const reset = await resetTime(gh);
  const retry =
    reset === undefined ? "Retry in a few minutes" : `Retry after ${reset}`;
  return `gh ${what} hit the GitHub rate limit. ${retry}; poll again then (gh api rate_limit shows the reset time).`;
}

/**
 * Runs one `gh` query and returns its JSON array of objects, or a message
 * naming what failed. Anything but a list of objects is refused, so a changed
 * `gh` output cannot be half-read. The lock is refreshed after every call.
 */
async function query(
  gh: Gh,
  what: string,
  args: string[],
): Promise<Record<string, unknown>[] | string> {
  const found = await gh.runner.run("gh", args);
  await gh.refresh();
  if (found.code !== 0) {
    if (RATE_LIMITED.test(`${found.stderr}${found.stdout}`)) {
      return rateLimited(gh, what);
    }
    return `gh ${what} failed: ${describe(found.code, found.stdout, found.stderr)}. Is gh installed and logged in (gh auth status)?`;
  }
  let value: unknown;
  try {
    value = JSON.parse(found.stdout);
  } catch {
    return `gh ${what} did not print JSON. Run it by hand and check the gh version.`;
  }
  const isObject = (v: unknown) =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  return Array.isArray(value) && value.every(isObject)
    ? (value as Record<string, unknown>[])
    : `gh ${what} did not print a JSON list of objects; the gh version may have changed its output.`;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

/** GitHub times come as `2026-01-02T03:04:05Z`; anything else is not trusted. */
const when = (value: unknown): string | undefined =>
  typeof value === "string" && isTimestamp(value) ? value : undefined;

const count = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && (value as number) >= 1
    ? (value as number)
    : undefined;

/** Only identifiers, labels, numbers and times are copied: never a title or body. */
function fromItems(
  items: unknown[],
  openedKind: "issue.opened" | "pr.opened",
  mergedKind?: "pr.merged",
): EventInput[] {
  const out: EventInput[] = [];
  for (const item of items) {
    const raw = asRecord(item);
    const number = count(raw["number"]);
    const opened = when(raw["createdAt"]);
    const merged = when(raw["mergedAt"]);
    if (number === undefined) {
      continue;
    }
    const at = (kind: EventInput["kind"], occurredAt: string, id: string) =>
      out.push({ id, source: "github", kind, occurredAt, number });
    if (opened !== undefined) {
      at(openedKind, opened, `github:${openedKind}:${number}`);
    }
    if (mergedKind !== undefined && merged !== undefined) {
      at(mergedKind, merged, `github:${mergedKind}:${number}`);
    }
  }
  return out;
}

function fromLabelEvents(items: unknown[]): EventInput[] {
  const out: EventInput[] = [];
  for (const item of items) {
    const raw = asRecord(item);
    const id = count(raw["id"]);
    const number = count(asRecord(raw["issue"])["number"]);
    const occurredAt = when(raw["created_at"]);
    const label = asRecord(raw["label"])["name"];
    if (
      raw["event"] === "labeled" &&
      id !== undefined &&
      number !== undefined &&
      occurredAt !== undefined &&
      typeof label === "string"
    ) {
      out.push({
        id: `github:issue.labelled:${id}`,
        source: "github",
        kind: "issue.labelled",
        occurredAt,
        number,
        label,
      });
    }
  }
  return out;
}

/**
 * Lists issues, label events and PRs through `gh` and appends the ones at or
 * after `since` (default: the latest recorded GitHub event) that the ledger
 * does not already hold. Each id is derived from GitHub's own number or event
 * id, so re-polling appends nothing; `occurredAt` is GitHub's timestamp. Only
 * identifiers, labels, numbers and times are stored. The poll holds a lock file
 * beside the ledger so concurrent pollers cannot append the same events.
 */
export async function pollGithub(deps: {
  ledger: Ledger;
  runner: Runner;
  clock: Clock;
  fs: FileSystem;
  repo: string;
  since?: string;
}): Promise<GithubPollResult> {
  const held = await acquire(deps.fs, deps.clock, `${deps.ledger.path}.lock`);
  if (!held.ok) {
    return { ok: false, message: held.message };
  }
  try {
    return await poll(deps, () => held.refresh());
  } finally {
    await held.release();
  }
}

interface Fetched {
  issues: Record<string, unknown>[];
  prs: Record<string, unknown>[];
  events: Record<string, unknown>[];
}

const PAGE = 100;
/** The events API serves at most 300 events: three pages. */
const MAX_PAGES = 3;

/** The day of `since`: gh search takes dates, and ids make the extra hours harmless. */
const searchFrom = (field: string, since?: string): string[] =>
  since === undefined ? [] : ["--search", `${field}:>=${since.slice(0, 10)}`];

/**
 * Label events, newest first, one page per call, stopping at a short page or
 * at the first page whose oldest event is before `since`.
 */
async function fetchEvents(
  gh: Gh,
  repo: string,
  since?: string,
): Promise<Record<string, unknown>[] | string> {
  const events: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const got = await query(gh, "api issues/events", [
      "api",
      `repos/${repo}/issues/events?per_page=${PAGE}&page=${page}`,
    ]);
    if (typeof got === "string") {
      return got;
    }
    events.push(...got);
    const oldest = when(got.at(-1)?.["created_at"]);
    const older =
      since !== undefined &&
      oldest !== undefined &&
      Date.parse(oldest) < Date.parse(since);
    if (got.length < PAGE || older) {
      break;
    }
  }
  return events;
}

/** Every `gh` listing the poll needs, bounded by `since`, or the message of the first that failed. */
async function fetchAll(
  gh: Gh,
  repo: string,
  since?: string,
): Promise<Fetched | string> {
  const flag = ["--repo", repo];
  const list = ["--state", "all", "--limit", String(LIMIT)];
  const issues = await query(gh, "issue list", [
    "issue",
    "list",
    ...flag,
    ...list,
    ...searchFrom("created", since),
    "--json",
    "number,createdAt",
  ]);
  if (typeof issues === "string") {
    return issues;
  }
  // Updated, not created: a PR opened long ago and merged since must appear.
  const prs = await query(gh, "pr list", [
    "pr",
    "list",
    ...flag,
    ...list,
    ...searchFrom("updated", since),
    "--json",
    "number,createdAt,mergedAt",
  ]);
  if (typeof prs === "string") {
    return prs;
  }
  const events = await fetchEvents(gh, repo, since);
  if (typeof events === "string") {
    return events;
  }
  if ([issues, prs].some((a) => a.length >= LIMIT)) {
    return `gh returned ${LIMIT} issues or PRs, the most one poll lists, so some may be missing. Pass a later --since, or raise LIMIT in github-poll.ts.`;
  }
  return { issues, prs, events };
}

async function poll(
  deps: {
    ledger: Ledger;
    runner: Runner;
    repo: string;
    since?: string;
  },
  refresh: () => Promise<void>,
): Promise<GithubPollResult> {
  const { events: known } = await deps.ledger.list({ source: "github" });
  const have = new Set(known.map((e) => e.id));
  const since =
    deps.since ??
    known
      .map((e) => e.occurredAt)
      .reduce<string | undefined>(
        (latest, t) =>
          latest === undefined || Date.parse(t) > Date.parse(latest)
            ? t
            : latest,
        undefined,
      );
  const fetched = await fetchAll(
    { runner: deps.runner, refresh },
    deps.repo,
    since,
  );
  if (typeof fetched === "string") {
    return { ok: false, message: fetched };
  }
  const { issues, prs, events } = fetched;
  // `since` only bounded the fetch above: the ids alone decide what is new.
  const planned = [
    ...fromItems(issues, "issue.opened"),
    ...fromItems(prs, "pr.opened", "pr.merged"),
    ...fromLabelEvents(events),
  ]
    .filter((e) => !have.has(e.id ?? ""))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const input of planned) {
    const result = await deps.ledger.record(input);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
  }
  return { ok: true, recorded: planned.length, events: planned };
}
