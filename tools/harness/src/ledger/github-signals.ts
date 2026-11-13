import type { Clock, FileSystem, Runner } from "../runtime/index.js";
import type { GithubPollResult } from "./github-poll.js";
import type { Ledger } from "./ledger.js";
import { acquire } from "./poll-lock.js";
import type { EventInput } from "./schema.js";

/**
 * The outcome signals agents do not write: how GitHub's own workflow runs
 * concluded (first attempts of runs GitHub started), which commits landed on
 * main as reverts, and when the owner login acted. Only numbers, conclusions
 * and times are kept: never a title, body, message or login. `owner.action`
 * trusts the login, which agents share until #336.
 */

import {
  DAY_MS,
  LIMIT,
  asRecord,
  count,
  json,
  list,
  pages,
  when,
} from "./github-gh.js";
import { fromActions } from "./github-owner-actions.js";

const WORKFLOWS = [
  // Only runs GitHub starts itself: a run an agent dispatches by hand is not counted.
  { file: "check.yml", kind: "ci.main", branch: "main", event: "push" },
  { file: "nightly.yml", kind: "ci.nightly", event: "schedule" },
] as const;

/** Success is a pass; every other conclusion (failure, timed out, cancelled, never started) counts against. */
function outcomeOf(conclusion: unknown): "success" | "failure" | undefined {
  if (typeof conclusion !== "string" || conclusion === "") {
    return undefined;
  }
  return conclusion === "success" ? "success" : "failure";
}

interface Known {
  have: Set<string>;
  /** Where to start: --since, else a day before the latest recorded signal. */
  since?: string;
}

/** A run's first attempt: a re-run keeps its id, so the later conclusion hides a failure. */
async function firstAttempt(
  runner: Runner,
  repo: string,
  id: number,
): Promise<{ conclusion: unknown; at: unknown } | string> {
  const got = await json(runner, "api run attempt", [
    "api",
    `repos/${repo}/actions/runs/${id}/attempts/1`,
  ]);
  const raw = asRecord(got);
  return typeof got === "string"
    ? got
    : { conclusion: raw["conclusion"], at: raw["updated_at"] };
}

async function fromRuns(
  runner: Runner,
  repo: string,
  known: Known,
): Promise<EventInput[] | string> {
  const out: EventInput[] = [];
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
      ...(known.since === undefined
        ? []
        : ["--created", `>=${known.since.slice(0, 10)}`]),
      "--json",
      "databaseId,conclusion,updatedAt,attempt",
    ]);
    if (typeof runs === "string") {
      return runs;
    }
    if (runs.length >= LIMIT) {
      return `gh returned ${LIMIT} ${file} runs, the most one poll lists, so some may be missing. Pass --since with a later time.`;
    }
    for (const raw of runs) {
      const id = count(raw["databaseId"]);
      if (id === undefined || known.have.has(`github:${kind}:${id}`)) {
        continue;
      }
      let conclusion = raw["conclusion"];
      let at = raw["updatedAt"];
      if ((count(raw["attempt"]) ?? 1) > 1) {
        const first = await firstAttempt(runner, repo, id);
        if (typeof first === "string") {
          return first;
        }
        ({ conclusion, at } = first);
      }
      const outcome = outcomeOf(conclusion);
      const time = when(at);
      if (outcome !== undefined && time !== undefined) {
        out.push({
          id: `github:${kind}:${id}`,
          source: "github",
          kind,
          occurredAt: time,
          outcome,
        });
      }
    }
  }
  return out;
}

const REVERT_SUBJECT = /^Revert "/;
const REVERT_BODY = /\bThis reverts commit\b/;

async function fromReverts(
  runner: Runner,
  repo: string,
  since?: string,
): Promise<EventInput[] | string> {
  const commits = await pages(
    runner,
    "api commits",
    `repos/${repo}/commits?sha=main`,
    since,
  );
  if (typeof commits === "string") {
    return commits;
  }
  const out: EventInput[] = [];
  for (const raw of commits) {
    const commit = asRecord(raw["commit"]);
    const message =
      typeof commit["message"] === "string" ? commit["message"] : "";
    const sha = raw["sha"];
    const at = when(asRecord(commit["committer"])["date"]);
    if (
      typeof sha === "string" &&
      /^[0-9a-f]{7,64}$/.test(sha) &&
      at !== undefined &&
      (REVERT_SUBJECT.test(message) || REVERT_BODY.test(message))
    ) {
      out.push({
        id: `github:main.revert:${sha}`,
        source: "github",
        kind: "main.revert",
        occurredAt: at,
      });
    }
  }
  return out;
}

const SIGNAL_KINDS = ["ci.main", "ci.nightly", "main.revert", "owner.action"];

/**
 * Appends ci.main, ci.nightly, main.revert and owner.action events that the
 * ledger does not hold. Ids come from GitHub's own run, commit, comment, event
 * and review ids, so re-polling appends nothing, and a run's result is its
 * first attempt, so a failure re-run to success is still seen. `since` (default:
 * a day before the latest recorded signal) bounds what is fetched; a listing
 * that cannot reach back that far fails the poll instead of recording part of
 * it. `owner` is the one login whose actions are kept.
 */
export async function pollSignals(deps: {
  ledger: Ledger;
  runner: Runner;
  clock: Clock;
  fs: FileSystem;
  repo: string;
  owner: string;
  since?: string;
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
    const latest = known
      .filter((e) => SIGNAL_KINDS.includes(e.kind))
      .map((e) => Date.parse(e.occurredAt))
      .reduce((a, b) => Math.max(a, b), Number.NEGATIVE_INFINITY);
    const since =
      deps.since ??
      (Number.isFinite(latest)
        ? new Date(latest - DAY_MS).toISOString().replace(/\.\d+Z$/, "Z")
        : undefined);
    const have = new Set(known.map((e) => e.id));
    const parts = [
      await fromRuns(deps.runner, deps.repo, {
        have,
        ...(since === undefined ? {} : { since }),
      }),
      await fromReverts(deps.runner, deps.repo, since),
      await fromActions(deps.runner, deps.repo, deps.owner, since),
    ];
    const failed = parts.find((p) => typeof p === "string");
    if (typeof failed === "string") {
      return { ok: false, message: failed };
    }
    const planned = (parts as EventInput[][])
      .flat()
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
