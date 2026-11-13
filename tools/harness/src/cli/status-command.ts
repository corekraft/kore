import { GITHUB_STAGES } from "../flow/index.js";
import {
  GuardrailError,
  readInventory,
  waitingRequests,
} from "../guardrail/index.js";
import { IdeaRepository } from "../idea/index.js";
import type { Ledger, LedgerEvent } from "../ledger/index.js";
import { readActivePlans } from "../plan/index.js";
import {
  CommandError,
  type Command,
  type CommandContext,
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

interface Waiting {
  rule: string;
  to: string;
  idea: string;
  requestedAt: string;
}

/** Guardrail changes waiting for a person's approval, from the ledger resolved against the inventory's history. */
async function waitingForApproval(
  { deps }: CommandContext,
  ledger: Ledger,
): Promise<{ waiting: Waiting[]; error?: string }> {
  try {
    const inventory = await readInventory(
      (path) => deps.fs.readFile(path),
      await deps.root(),
    );
    const pending = await waitingRequests(deps, inventory, ledger);
    return {
      waiting: [...pending].map(([rule, { to, idea, requestedAt }]) => ({
        rule,
        to,
        idea,
        requestedAt,
      })),
    };
  } catch (error) {
    if (!(error instanceof GuardrailError)) {
      throw error;
    }
    return { waiting: [], error: error.message };
  }
}

export const statusCommand: Command = {
  summary:
    "report open plan items, ideas by state and recent ledger stages; read-only, for the concierge",
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
      guardrails: await waitingForApproval(context, opened.ledger),
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
    for (const w of status.guardrails.waiting) {
      lines.push(
        `Waiting for approval: ${w.rule} to ${w.to} (idea ${w.idea}, requested ${w.requestedAt})`,
      );
    }
    if (status.guardrails.error !== undefined) {
      lines.push(`Guardrails unreadable: ${status.guardrails.error}`);
    }
    for (const r of status.ledger.recent) {
      lines.push(`${r.occurredAt} ${r.stage} ${r.kind}`);
    }
    context.deps.stdout(`${lines.join("\n")}\n`);
    return 0;
  },
};
