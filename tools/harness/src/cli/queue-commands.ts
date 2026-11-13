import { IdeaRepository } from "../idea/index.js";
import {
  ESCALATION_MODEL,
  ESCALATION_THRESHOLD,
  buildQueue,
  countSendBacks,
  writerTier,
  type OpenPr,
  type QueueItem,
} from "../queue/index.js";
import { resolveTier } from "../session/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";

const FAILED = 1;
const APPROVED_LABEL = "ready-for-agent";

class QueueError extends Error {}

async function gh(context: CommandContext, args: string[], root: string) {
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

async function repoName(context: CommandContext, root: string) {
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

/** Runs an action, turning a QueueError into an actionable message and a non-zero exit. */
async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<void>,
): Promise<number> {
  try {
    await action();
    return 0;
  } catch (error) {
    if (!(error instanceof QueueError)) {
      throw error;
    }
    deps.stderr(
      `${json ? `${JSON.stringify({ error: error.message })}\n` : ""}${error.message}\n`,
    );
    return FAILED;
  }
}

async function openedLedger(context: CommandContext) {
  const opened = await openLedger(context);
  if ("error" in opened) {
    throw new QueueError(opened.error);
  }
  return opened.ledger;
}

function prOf(context: CommandContext, verb: string): number {
  const { operand } = context;
  if (operand === undefined || !/^\d+$/.test(operand) || Number(operand) < 1) {
    throw new QueueError(
      `Missing or invalid PR number. Run \`harness queue ${verb} <pr>\`.`,
    );
  }
  return Number(operand);
}

const describeItem = (item: QueueItem): string =>
  item.kind === "idea"
    ? `idea ${item.idea} (issue #${item.issue}) approved ${item.since}`
    : `send-back on PR #${item.pr} (${item.count} so far) since ${item.since}`;

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
async function approvedIssues(
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

async function openPullRequests(
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

function render(queue: QueueItem[], json: boolean): string {
  if (json) {
    return `${JSON.stringify({ queue })}\n`;
  }
  if (queue.length === 0) {
    return "The queue is empty.\n";
  }
  return `${queue.map(describeItem).join("\n")}\n`;
}

async function next(context: CommandContext): Promise<void> {
  const { deps, json } = context;
  const root = await deps.root();
  const ledger = await openedLedger(context);
  const repo = await repoName(context, root);
  const queue = buildQueue({
    ideas: await new IdeaRepository(deps.fs, deps.clock, root).list(),
    approved: await approvedIssues(context, repo, root),
    openPrs: await openPullRequests(context, repo, root),
    sendBacks: (await ledger.list({ kind: "send-back" })).events,
  });
  deps.stdout(render(queue, json));
}

async function countFor(context: CommandContext, pr: number) {
  const ledger = await openedLedger(context);
  const count = countSendBacks(
    (await ledger.list({ kind: "send-back" })).events,
    pr,
  );
  return { ledger, count };
}

/** The model to launch: the writer's declared default below the threshold, Sonnet from it. */
async function modelFor(context: CommandContext, count: number) {
  if (count >= ESCALATION_THRESHOLD) {
    return writerTier(count, ESCALATION_MODEL);
  }
  const declared = await resolveTier(context.deps, "writer", {});
  if ("error" in declared) {
    throw new QueueError(declared.error);
  }
  return writerTier(count, declared.model);
}

async function sendBacks(context: CommandContext): Promise<void> {
  const pr = prOf(context, "send-backs");
  const { count } = await countFor(context, pr);
  const { model, escalate } = await modelFor(context, count);
  context.deps.stdout(
    context.json
      ? `${JSON.stringify({ pr, count, model, escalate })}\n`
      : `PR #${pr}: sent back ${count} time${count === 1 ? "" : "s"}; launch the writer on ${model}\n`,
  );
}

async function escalateWriter(context: CommandContext): Promise<void> {
  const { deps, json } = context;
  const pr = prOf(context, "escalate");
  const { ledger, count } = await countFor(context, pr);
  if (count < ESCALATION_THRESHOLD) {
    throw new QueueError(
      `PR #${pr} was sent back ${count} time${count === 1 ? "" : "s"}; a writer escalates after ${ESCALATION_THRESHOLD}. Relaunch it on its default model instead.`,
    );
  }
  const { model } = await modelFor(context, count);
  const logged = await ledger.list({ kind: "escalation" });
  if (!logged.events.some((e) => e.number === pr)) {
    const event = await ledger.record({
      source: "github",
      kind: "escalation",
      occurredAt: deps.clock.now().toISOString(),
      number: pr,
      label: model,
    });
    if (!event.ok) {
      throw new QueueError(
        `The escalation event was rejected: ${event.message} Fix the ledger, then rerun \`harness queue escalate ${pr}\`.`,
      );
    }
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ pr, count, model, escalated: true })}\n`
      : `PR #${pr}: escalation recorded; launch the writer with \`session spawn --role writer --model ${model}\`\n`,
  );
}

const nextCommand: Command = {
  summary:
    "read-only; list approved ideas without an outcome and pending judge send-backs, oldest first ([--json] [--ledger])",
  options: { ledger: "string" },
  run: (context) => guarded(context, () => next(context)),
};

const sendBacksCommand: Command = {
  summary: `read-only; count a PR's judge send-backs and name the writer model to launch: Sonnet from ${ESCALATION_THRESHOLD}, else the writer's default (<pr> [--json] [--ledger])`,
  operand: "pr",
  options: { ledger: "string" },
  run: (context) => guarded(context, () => sendBacks(context)),
};

const escalateCommand: Command = {
  summary: `append an escalation event to the ledger once a PR has ${ESCALATION_THRESHOLD} send-backs, one per PR; then relaunch the writer with \`session spawn --model\` (<pr> [--json] [--ledger])`,
  operand: "pr",
  options: { ledger: "string" },
  run: (context) => guarded(context, () => escalateWriter(context)),
};

export const queueCommands: Record<string, Command> = {
  next: nextCommand,
  "send-backs": sendBacksCommand,
  escalate: escalateCommand,
};
