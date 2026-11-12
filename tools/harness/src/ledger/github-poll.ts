import type { Clock, FileSystem, Runner } from "../runtime/index.js";
import { acquire } from "./poll-lock.js";
import type { Ledger } from "./ledger.js";
import { isTimestamp, type EventInput } from "./schema.js";

export type GithubPollResult =
  | { ok: true; recorded: number; events: EventInput[] }
  | { ok: false; message: string };

const LIMIT = "1000";

const describe = (code: number, stdout: string, stderr: string) => {
  const text = `${stderr}${stdout}`.trim();
  return text === "" ? `exit code ${code}` : `exit code ${code}: ${text}`;
};

/** Runs one `gh` query and returns its JSON array, or a message naming what failed. */
async function query(
  runner: Runner,
  what: string,
  args: string[],
): Promise<unknown[] | string> {
  const found = await runner.run("gh", args);
  if (found.code !== 0) {
    return `gh ${what} failed: ${describe(found.code, found.stdout, found.stderr)}. Is gh installed and logged in (gh auth status)?`;
  }
  let value: unknown;
  try {
    value = JSON.parse(found.stdout);
  } catch {
    return `gh ${what} did not print JSON. Run it by hand and check the gh version.`;
  }
  return Array.isArray(value)
    ? value
    : `gh ${what} printed no JSON list; the gh version may have changed its output.`;
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
    return await poll(deps);
  } finally {
    await held.release();
  }
}

interface Fetched {
  issues: unknown[];
  prs: unknown[];
  pages: unknown[];
}

/** Every `gh` listing the poll needs, or the message of the first that failed. */
async function fetchAll(
  runner: Runner,
  repo: string,
): Promise<Fetched | string> {
  const flag = ["--repo", repo];
  const list = ["--state", "all", "--limit", LIMIT];
  const issues = await query(runner, "issue list", [
    "issue",
    "list",
    ...flag,
    ...list,
    "--json",
    "number,createdAt",
  ]);
  const prs = await query(runner, "pr list", [
    "pr",
    "list",
    ...flag,
    ...list,
    "--json",
    "number,createdAt,mergedAt",
  ]);
  const pages = await query(runner, "api issues/events", [
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/issues/events`,
  ]);
  const failed = [issues, prs, pages].find((a) => typeof a === "string");
  return typeof failed === "string"
    ? failed
    : {
        issues: issues as unknown[],
        prs: prs as unknown[],
        pages: pages as unknown[],
      };
}

async function poll(deps: {
  ledger: Ledger;
  runner: Runner;
  repo: string;
  since?: string;
}): Promise<GithubPollResult> {
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
  const fetched = await fetchAll(deps.runner, deps.repo);
  if (typeof fetched === "string") {
    return { ok: false, message: fetched };
  }
  const { issues, prs, pages } = fetched;
  const planned = [
    ...fromItems(issues, "issue.opened"),
    ...fromItems(prs, "pr.opened", "pr.merged"),
    ...fromLabelEvents(pages.flat()),
  ]
    .filter(
      (e) =>
        !have.has(e.id ?? "") &&
        (since === undefined || Date.parse(e.occurredAt) >= Date.parse(since)),
    )
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  for (const input of planned) {
    const result = await deps.ledger.record(input);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }
  }
  return { ok: true, recorded: planned.length, events: planned };
}
