import { openOwnerQuestions, type OwnerQuestion } from "../decision/index.js";
import { GITHUB_STAGES } from "../flow/index.js";
import { IdeaRepository } from "../idea/index.js";
import type { LedgerEvent } from "../ledger/index.js";
import { tickHeartbeat } from "../orchestrator/index.js";
import { readActivePlans } from "../plan/index.js";
import {
  CommandError,
  type Command,
  type CommandContext,
  type CommandHelp,
} from "../runtime/index.js";
import { openLedger } from "./ledger-commands.js";

const RECENT = 10;

interface RecentStage {
  occurredAt: string;
  stage: string;
  kind: string;
  number?: number;
  idea?: string;
}

/** The stage a GitHub event maps to. An event's own `stage` is free text any agent can set, so it is never trusted. */
function stageOf(event: LedgerEvent): string | undefined {
  return event.source === "github" ? GITHUB_STAGES[event.kind] : undefined;
}

function recentStages(events: readonly LedgerEvent[]): RecentStage[] {
  return events
    .flatMap((event) => {
      const stage = stageOf(event);
      if (stage === undefined) {
        return [];
      }
      const recent: RecentStage = {
        occurredAt: event.occurredAt,
        stage,
        kind: event.kind,
      };
      if (event.number !== undefined) {
        recent.number = event.number;
      }
      if (event.idea !== undefined) {
        recent.idea = event.idea;
      }
      return [recent];
    })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, RECENT);
}

/** The owner's open reserved questions, blocking first, under one counted line; none when none is open. */
function ownerQuestionLines(questions: readonly OwnerQuestion[]): string[] {
  if (questions.length === 0) {
    return [];
  }
  const blocking = questions.filter((question) => question.blocking).length;
  return [
    `Owner questions: ${questions.length} open, ${blocking} blocking`,
    ...questions.map(
      (question) =>
        `- idea ${question.idea} (${question.category}), asked ${question.since}${question.blocking ? ", blocking" : ""}`,
    ),
  ];
}

async function ideas({ deps }: CommandContext) {
  const repository = new IdeaRepository(deps.fs, deps.clock, await deps.root());
  const items = (await repository.list()).map((record) => ({
    number: record.number,
    title: record.title,
    state: record.outcome ?? "open",
  }));
  const byState: Record<string, number> = {};
  for (const { state } of items) {
    byState[state] = (byState[state] ?? 0) + 1;
  }
  return { byState, items };
}

const statusHelp: CommandHelp = {
  purpose:
    "Reports where the work stands in one read: the open plan items, the ideas by state, the open owner questions with the blocking ones first, the recent GitHub stages in the ledger, and the orchestrator tick's heartbeat: none, running, stopped, or gap when the tick is not running.",
  when: "When the main session needs the picture before it acts: what is open, what waits on the owner, and whether the tick is running.",
  whenNot:
    "When you need one event or one idea: use ledger list for events, or idea show for an idea. status summarises all of them, and changes nothing.",
  flags: {},
  examples: [
    {
      command: "harness status",
      shows:
        "the plan lines, the idea counts by state, any open owner questions, a line when the tick is not running, and the recent GitHub stages",
    },
    {
      command: "harness status --json",
      shows:
        "the same report as one object, with the plans, ideas, ledger, tick and ownerQuestions keys",
    },
  ],
  exits: [
    { code: 0, meaning: "the report is printed" },
    {
      code: 1,
      meaning:
        "no shared ledger root can be found, so the ledger cannot be read; stderr names the fix",
    },
  ],
  effects: {
    kind: "read-only",
    detail:
      "reads the active plans, the idea records and the ledger, then prints the report. It writes nothing.",
  },
  seeAlso: ["ledger list", "idea show", "decision digest"],
};

export const statusCommand: Command = {
  summary:
    "report open plan items, ideas by state, the open owner questions (ADR 0120, blocking first), recent ledger stages and the orchestrator tick's heartbeat (tick: none, running, stopped, or gap, which prints 'the tick is not running' when its latest heartbeat is older than the gap with no stop after it); read-only, for the person's main session",
  help: statusHelp,
  async run(context) {
    const opened = await openLedger(context);
    if ("error" in opened) {
      throw new CommandError(opened.error);
    }
    const { events, skipped } = await opened.ledger.list({});
    const status = {
      plans: await readActivePlans(context.deps),
      ideas: await ideas(context),
      ledger: { recent: recentStages(events), skipped },
      tick: tickHeartbeat(events, context.deps.clock.now()),
      ownerQuestions: openOwnerQuestions(events),
    };
    if (context.json) {
      context.deps.stdout(`${JSON.stringify(status)}\n`);
      return 0;
    }
    const lines = status.plans.map(
      (plan) =>
        `${plan.file}: ${plan.open.map((o) => `${o.step} (${o.count})`).join(", ") || "no open items"}`,
    );
    lines.push(
      `Ideas: ${
        Object.entries(status.ideas.byState)
          .map(([state, count]) => `${count} ${state}`)
          .join(", ") || "none"
      }`,
    );
    lines.push(...ownerQuestionLines(status.ownerQuestions));
    if (status.tick.state === "gap") {
      lines.push(
        `the tick is not running: no heartbeat since ${status.tick.lastAt}`,
      );
    }
    for (const r of status.ledger.recent) {
      lines.push(`${r.occurredAt} ${r.stage} ${r.kind}`);
    }
    context.deps.stdout(`${lines.join("\n")}\n`);
    return 0;
  },
};
