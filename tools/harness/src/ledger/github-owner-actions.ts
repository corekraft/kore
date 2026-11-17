import type { Runner } from "../runtime/index.js";
import { readSender } from "../sender/index.js";
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

/** Opens a comment `harness approve` posts when it labels an idea; the comment and that label are the agent's, not the owner's. */
export const APPROVED_MARKER = "<!-- harness:auto-approved -->";
/** Opens a comment `harness approve` posts when it leaves an idea for a person. */
export const REFUSED_MARKER = "<!-- harness:left-for-person -->";

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
  const bodyOf = (c: Raw) => (typeof c["body"] === "string" ? c["body"] : "");
  const agentMade = (c: Raw) =>
    bodyOf(c).startsWith(APPROVED_MARKER) ||
    bodyOf(c).startsWith(REFUSED_MARKER);
  const autoApproved = new Set(
    comments
      .filter((c) => bodyOf(c).startsWith(APPROVED_MARKER))
      .map((c) => issueNumber(c["issue_url"])),
  );
  const agentLabel = (e: Raw) =>
    e["event"] === "labeled" &&
    asRecord(e["label"])["name"] === "ready-for-agent" &&
    autoApproved.has(count(asRecord(e["issue"])["number"]));
  const add = (
    id: string,
    login: unknown,
    at: unknown,
    number: number | undefined,
    kind: "owner.action" | "owner.replied" = "owner.action",
  ) => {
    const time = when(at);
    if (login === owner && time !== undefined && number !== undefined) {
      out.push({ id, source: "github", kind, occurredAt: time, number });
    }
  };
  for (const c of comments.filter((each) => !agentMade(each))) {
    const id = String(c["id"]);
    const login = asRecord(c["user"])["login"];
    const number = issueNumber(c["issue_url"]);
    add(`github:owner.action:comment:${id}`, login, c["created_at"], number);
    // An untagged comment by the owner's login is a reply: it closes a reserved question on its issue (#854).
    if (readSender(bodyOf(c)) === undefined) {
      add(
        `github:owner.replied:comment:${id}`,
        login,
        c["created_at"],
        number,
        "owner.replied",
      );
    }
  }
  for (const e of events.filter((each) => !agentLabel(each))) {
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
