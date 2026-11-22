import { IdeaRepository } from "../idea/index.js";
import {
  ESCALATION_MODEL,
  ESCALATION_THRESHOLD,
  FrontierError,
  TICKET_QUEUE_FLAG,
  buildFrontier,
  buildQueue,
  countSendBacks,
  readReadyIssues,
  ticketQueueOn,
  writerTier,
  type QueueItem,
} from "../queue/index.js";
import { resolveTier } from "../session/index.js";
import type { Command, CommandContext } from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";
import { QueueError } from "./queue-error.js";
import {
  approvedIssues,
  gh,
  mergedPullRequests,
  openPullRequests,
  repoName,
} from "./queue-gh.js";
import {
  explainedIssue,
  explanation,
  renderFrontier,
} from "./queue-frontier-view.js";

const FAILED = 1;

/** Runs an action, turning a reported error into an actionable message and a non-zero exit. */
async function guarded(
  { json, deps }: CommandContext,
  action: () => Promise<void>,
): Promise<number> {
  try {
    await action();
    return 0;
  } catch (error) {
    if (!isReported(error)) {
      throw error;
    }
    deps.stderr(
      `${json ? `${JSON.stringify({ error: error.message })}\n` : ""}${error.message}\n`,
    );
    return FAILED;
  }
}

/** Errors this command names and reports; anything else is a bug and propagates. */
const isReported = (error: unknown): error is Error =>
  error instanceof QueueError || error instanceof FrontierError;

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

const describeItem = (item: QueueItem): string => {
  if (item.kind === "idea") {
    return `idea ${item.idea} (issue #${item.issue}) approved ${item.since}`;
  }
  if (item.kind === "ticket") {
    return `ticket issue #${item.issue} lane ${item.lane} horizon ${item.horizon} since ${item.since}`;
  }
  return `send-back on PR #${item.pr} (${item.count} so far) since ${item.since}`;
};

function render(queue: QueueItem[], json: boolean): string {
  if (json) {
    return `${JSON.stringify({ queue })}\n`;
  }
  if (queue.length === 0) {
    return "The queue is empty.\n";
  }
  return `${queue.map(describeItem).join("\n")}\n`;
}

/** The queue as it has always been: approved ideas and send-backs, oldest first. */
async function nextToday(context: CommandContext, root: string) {
  const { deps, json } = context;
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

/** The frontier behind the tick-ticket-queue flag: the steering view, or one issue's place in it. */
async function nextFrontier(
  context: CommandContext,
  root: string,
  explain: number | undefined,
) {
  const { deps, json } = context;
  const ledger = await openedLedger(context);
  const repo = await repoName(context, root);
  const frontier = buildFrontier({
    issues: await readReadyIssues((args) => gh(context, args, root), repo),
    ideas: await new IdeaRepository(deps.fs, deps.clock, root).list(),
    openPrs: await openPullRequests(context, repo, root),
    mergedPrs: await mergedPullRequests(context, repo, root),
    sendBacks: (await ledger.list({ kind: "send-back" })).events,
  });
  if (explain === undefined) {
    deps.stdout(renderFrontier(frontier, json));
    return;
  }
  const answer = explanation(explain, frontier);
  deps.stdout(json ? `${JSON.stringify(answer.json)}\n` : `${answer.text}\n`);
}

async function next(context: CommandContext): Promise<void> {
  const root = await context.deps.root();
  const explain = explainedIssue(context.options["explain"]);
  if (!(await ticketQueueOn(context.deps.fs, root))) {
    if (explain !== undefined) {
      throw new QueueError(
        `--explain needs the local ${TICKET_QUEUE_FLAG} flag, which is off; run \`harness queue next\` without --explain, or ask the owner to turn the flag on.`,
      );
    }
    await nextToday(context, root);
    return;
  }
  await nextFrontier(context, root, explain);
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
      : `PR #${pr}: escalation recorded; launch the writer with \`session spawn --role writer --model ${model} --pr ${pr}\`\n`,
  );
}

export const nextCommand: Command = {
  summary:
    "Lists the approved ideas and judge send-backs the orchestrator takes next, oldest first.",
  options: { ledger: "string", explain: "string" },
  run: (context) => guarded(context, () => next(context)),
};

export const sendBacksCommand: Command = {
  summary:
    "Counts a pull request's judge send-backs and names the writer model to relaunch it on.",
  operand: "pr",
  options: { ledger: "string" },
  run: (context) => guarded(context, () => sendBacks(context)),
};

export const escalateCommand: Command = {
  summary:
    "Records a writer's escalation after two send-backs and prints the spawn line that relaunches it.",
  operand: "pr",
  options: { ledger: "string" },
  run: (context) => guarded(context, () => escalateWriter(context)),
};

export const queueCommands: Record<string, Command> = {
  next: nextCommand,
  "send-backs": sendBacksCommand,
  escalate: escalateCommand,
};
