import type { Runner } from "../runtime/index.js";
import {
  LIMIT,
  asRecord,
  count,
  list,
  pages,
  when,
  type Raw,
} from "./github-gh.js";
import type { EventInput } from "./schema.js";

/** What GitHub says the owner did: comments, issue events and pull request reviews, as raw listings. */
interface Sources {
  comments: Raw[];
  events: Raw[];
  prs: Raw[];
}

async function fetchSources(
  runner: Runner,
  repo: string,
  since?: string,
): Promise<Sources | string> {
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
  const prs = await list(runner, "pr list", [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    String(LIMIT),
    ...(since === undefined
      ? []
      : ["--search", `updated:>=${since.slice(0, 10)}`]),
    "--json",
    "number,reviews",
  ]);
  if (typeof prs === "string") {
    return prs;
  }
  if (prs.length >= LIMIT) {
    return `gh returned ${LIMIT} pull requests, the most one poll lists, so some reviews may be missing. Pass --since with a later time.`;
  }
  return { comments, events, prs };
}

const issueNumber = (url: unknown) =>
  count(Number(/\/issues\/(\d+)$/.exec(String(url))?.[1]));

/** The owner login's actions as events: a number and a time each, never a body or a login. */
function ownerEvents(
  { comments, events, prs }: Sources,
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
  for (const pr of prs) {
    for (const r of Array.isArray(pr["reviews"]) ? pr["reviews"] : []) {
      const review = asRecord(r);
      add(
        `github:owner.action:review:${String(review["id"])}`,
        asRecord(review["author"])["login"],
        review["submittedAt"],
        count(pr["number"]),
      );
    }
  }
  return out;
}

/** The owner's comments, issue events and pull request reviews since `since`, or the message of the listing that failed. */
export async function fromActions(
  runner: Runner,
  repo: string,
  owner: string,
  since?: string,
): Promise<EventInput[] | string> {
  const sources = await fetchSources(runner, repo, since);
  return typeof sources === "string" ? sources : ownerEvents(sources, owner);
}
