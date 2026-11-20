import { judgeLaunch, writerLaunch, type Launch } from "./idea-run.js";
import type { TickPorts } from "./tick.js";

const PREFIX = "ticket-";

/** A ticket with this label is a live proof's, which another path works; the tick starts nothing for it. */
const LIVE_PROOF_LABEL = "live-proof";

export type Queue = Awaited<ReturnType<TickPorts["queue"]>>;
export type QueuedIdea = Extract<Queue[number], { kind: "idea" }>;
type Titles = Pick<TickPorts, "issueTitle">;

/** The key a ticket goes by in a pass, so its panes are named idea-ticket-N-..., a name `session spawn` accepts. */
export const ticketKey = (issue: number): string => `${PREFIX}${issue}`;

/** Whether a pass key names a plain ticket rather than an idea. */
export const isTicketKey = (key: string): boolean => key.startsWith(PREFIX);

/** The writer's brief for a ticket: the issue and title, and where to read the rest. */
export const ticketWriterBrief = (issue: number, title: string): string =>
  `Work issue #${issue}: ${title}. Read the issue, follow writer.md, and deliver it as one pull request that says \`Refs #${issue}\`. Do not merge.`;

/** The judge's brief for a ticket's pull request. */
export const ticketJudgeBrief = (
  pr: number,
  issue: number,
  title: string,
): string =>
  `Judge PR #${pr} for issue #${issue} (${title}): run the precheck, then approve and merge it, or send it back with the reason.`;

/**
 * The queue's ideas, and, with the `tick-ticket-queue` flag on, its plain tickets as ideas keyed
 * `ticket-<issue>` so they take the idea path. `only` keeps one key. A live-proof ticket, and a ticket for an issue an
 * idea in the queue works, are left out. The flag is read only when the queue holds a ticket.
 */
export async function workedItems(
  queue: Queue,
  ports: Pick<TickPorts, "ticketsOn">,
  only?: string,
): Promise<QueuedIdea[]> {
  const items = await allItems(queue, ports);
  return items.filter((item) => only === undefined || item.idea === only);
}

async function allItems(
  queue: Queue,
  ports: Pick<TickPorts, "ticketsOn">,
): Promise<QueuedIdea[]> {
  const ideas = queue.filter(
    (item): item is QueuedIdea => item.kind === "idea",
  );
  if (
    !queue.some((item) => item.kind === "ticket") ||
    !(await ports.ticketsOn())
  ) {
    return ideas;
  }
  const taken = new Set(ideas.map((i) => i.issue));
  const tickets: QueuedIdea[] = [];
  for (const item of queue) {
    if (
      item.kind === "ticket" &&
      !item.labels.includes(LIVE_PROOF_LABEL) &&
      !taken.has(item.issue)
    ) {
      tickets.push({
        kind: "idea",
        idea: ticketKey(item.issue),
        issue: item.issue,
        since: item.since,
      });
    }
  }
  return [...ideas, ...tickets];
}

/** The writer's launch; a ticket's brief names its issue and title, read once here, and an idea's is its own. */
export async function writerFor(
  { idea, issue }: Pick<QueuedIdea, "idea" | "issue">,
  ports: Titles,
  model: string | undefined,
  name?: string,
): Promise<Launch> {
  return isTicketKey(idea)
    ? writerLaunch(
        idea,
        issue,
        model,
        name,
        ticketWriterBrief(issue, await ports.issueTitle(issue)),
      )
    : writerLaunch(idea, issue, model, name);
}

/** The judge's launch; a ticket's brief names its issue and title. */
export async function judgeFor(
  { idea, issue }: Pick<QueuedIdea, "idea" | "issue">,
  ports: Titles,
  pr: number,
  name: string,
): Promise<Launch> {
  return isTicketKey(idea)
    ? judgeLaunch(
        idea,
        pr,
        issue,
        name,
        ticketJudgeBrief(pr, issue, await ports.issueTitle(issue)),
      )
    : judgeLaunch(idea, pr, issue, name);
}
