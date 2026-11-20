import type { OpenPr } from "../queue/index.js";
import type { CommandContext } from "../runtime/index.js";
import { QueueError } from "./queue-error.js";

const APPROVED_LABEL = "ready-for-agent";

/** Runs `gh` in the checkout and returns its stdout, or a QueueError naming the failed call. */
export async function gh(
  context: CommandContext,
  args: string[],
  root: string,
) {
  const done = await context.deps.runner.run("gh", args, { cwd: root });
  if (done.code !== 0) {
    throw new QueueError(
      `gh ${args.slice(0, 2).join(" ")} failed: ${done.stderr.trim() || "no output"}. Check \`gh auth status\`, then rerun.`,
    );
  }
  return done.stdout;
}

function parsed(text: string, what: string): unknown[] {
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value)) {
      return value;
    }
  } catch {
    // Reported below with the rest of the unreadable output.
  }
  throw new QueueError(`gh returned unreadable ${what}; rerun the command.`);
}

const rowsOf = (text: string, what: string) =>
  parsed(text, what).filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );

/** The repository gh names for this checkout; every list call names it. */
export async function repoName(context: CommandContext, root: string) {
  const view = await gh(
    context,
    ["repo", "view", "--json", "nameWithOwner"],
    root,
  );
  try {
    const name = (JSON.parse(view) as { nameWithOwner?: unknown })
      .nameWithOwner;
    if (typeof name === "string" && name !== "") {
      return name;
    }
  } catch {
    // Falls through to the error below.
  }
  throw new QueueError(
    "gh could not tell which repository this is; run it inside the repository.",
  );
}

async function listRows(
  context: CommandContext,
  repo: string,
  root: string,
  args: string[],
  what: string,
) {
  return rowsOf(
    await gh(context, [...args, "--repo", repo, "--limit", "200"], root),
    what,
  );
}

/** Open issues carrying the approval label, keyed by number, with their creation time. */
export async function approvedIssues(
  context: CommandContext,
  repo: string,
  root: string,
) {
  const rows = await listRows(
    context,
    repo,
    root,
    [
      "issue",
      "list",
      "--label",
      APPROVED_LABEL,
      "--state",
      "open",
      "--json",
      "number,createdAt",
    ],
    "issue list",
  );
  const approved = new Map<number, string>();
  for (const row of rows) {
    if (
      typeof row["number"] === "number" &&
      typeof row["createdAt"] === "string"
    ) {
      approved.set(row["number"], row["createdAt"]);
    }
  }
  return approved;
}

/** Open pull requests and the head each is at. */
export async function openPullRequests(
  context: CommandContext,
  repo: string,
  root: string,
) {
  const rows = await listRows(
    context,
    repo,
    root,
    ["pr", "list", "--state", "open", "--json", "number,headRefOid"],
    "PR list",
  );
  const openPrs: OpenPr[] = [];
  for (const row of rows) {
    if (
      typeof row["number"] === "number" &&
      typeof row["headRefOid"] === "string"
    ) {
      openPrs.push({ number: row["number"], head: row["headRefOid"] });
    }
  }
  return openPrs;
}
