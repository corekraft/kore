import { ticketQueueOn, type QueueItem } from "../queue/index.js";
import type { FileSystem } from "../runtime/index.js";
import type { Launch } from "./idea-run.js";
import { localFlagOn } from "./local-flag.js";
import type { BoundName } from "./tick-bounds.js";
import type { IdeaPane, IdeaStep } from "./tick.js";
import type { Starts } from "./tick-starts.js";

/** The flag that lets the tick hand live-proof tickets to a live-proof pane; off until the owner activates it. */
export const LIVE_PROOFS_FLAG = "tick-live-proofs";

/** The ticket label that marks a live proof for the delivery host. */
export const LIVE_PROOF_LABEL = "live-proof";

const NAME_PREFIX = "live-proof-";
const MODEL = "claude-sonnet-5-5";

/** Whether the local overlay turns on live proofs: tick-live-proofs and tick-ticket-queue (the queue's own flag) are both on. */
export async function liveProofsOn(
  fs: FileSystem,
  root: string,
): Promise<boolean> {
  return (
    (await ticketQueueOn(fs, root)) &&
    (await localFlagOn(fs, root, LIVE_PROOFS_FLAG))
  );
}

/** The pane a ticket's live proof runs in, so a rerun finds it and starts nothing twice. */
export function liveProofName(issue: number): string {
  return `${NAME_PREFIX}${issue}`;
}

/** What the live-proof pane is told: take the lease, run the proof, record it through the existing tools. */
export function liveProofBrief(issue: number): string {
  return [
    `Run the live proof that issue #${issue} names, on the delivery host. Read the issue first.`,
    "Take the host lease the way a live run does (`kore local up` takes it), run `kore local up` on the configured local context, then the test task the issue names.",
    "A ticket has no idea of its own. For each flag the ticket proves, find the idea whose record names that flag and environment (search docs/ideas, or run `harness idea list`), then record the result with the full command: `harness outcome record --idea <that idea> --kind verification --source live-run --result confirmed|refuted --flag <name> --environment local --evidence <the run's log or ledger reference> --summary <one line>`.",
    "If no idea names the flag, record nothing: comment the gap on the ticket with `harness decision ask`, which labels it needs-info, and end blocked.",
    "Also comment the result on the issue through a harness command, which writes the sender line. Never run `harness flag activate`.",
    "On a missing prerequisite, run `harness decision ask` to comment the blocker and its clearing command (it labels the issue needs-info), then end blocked.",
    "Never dispatch live.yml or the nightly, and never reach kore-vps.",
  ].join("\n");
}

/** What the live-proof pass reads and does. */
export interface LiveProofPorts {
  /** Every live-proof pane, running, finished or closed; read-only. */
  panes(): Promise<IdeaPane[]>;
  /** `session spawn --no-wait`. */
  spawn(launch: Launch): Promise<void>;
  /** `session close`. */
  close(name: string): Promise<void>;
}

const issueOf = (name: string): number =>
  Number(name.slice(NAME_PREFIX.length));

const stepFor = (issue: number): Pick<IdeaStep, "idea" | "issue"> => ({
  idea: `ticket-${issue}`,
  issue,
});

/**
 * The live-proof part of a pass: at most one live-proof pane at a time on the host. It closes a
 * finished pane, holds while another runs or the host is bound, and otherwise starts one pane for
 * the first queued live-proof ticket that has none. A ticket whose pane already ran is never
 * started again.
 */
export class LiveProofs {
  constructor(private readonly ports: LiveProofPorts) {}

  async pass(queue: readonly QueueItem[], starts: Starts): Promise<IdeaStep[]> {
    const tickets = queue.flatMap((item) =>
      item.kind === "ticket" && item.labels.includes(LIVE_PROOF_LABEL)
        ? [item.issue]
        : [],
    );
    if (tickets.length === 0) {
      return [];
    }
    const panes = await this.ports.panes();
    const finished = panes.find(
      (p) => p.state !== "closed" && p.state !== "running",
    );
    if (finished !== undefined) {
      await this.ports.close(finished.name);
      return [
        {
          ...stepFor(issueOf(finished.name)),
          step: "close",
          pane: finished.name,
        },
      ];
    }
    const issue = tickets.find(
      (n) => !panes.some((p) => p.name === liveProofName(n)),
    );
    if (issue === undefined) {
      return [{ ...stepFor(tickets[0] as number), step: "blocked" }];
    }
    const bound = await this.bound(issue, panes, starts);
    if (bound !== undefined) {
      return [{ ...stepFor(issue), step: "held", bound }];
    }
    const name = liveProofName(issue);
    await this.ports.spawn({
      role: "writer",
      name,
      issue,
      worktree: true,
      model: MODEL,
      brief: liveProofBrief(issue),
    });
    starts.taken();
    return [{ ...stepFor(issue), step: "spawn-live-proof", pane: name }];
  }

  /** The bound that holds the start: another live-proof pane, recorded first, then the host's bounds. */
  private async bound(
    issue: number,
    panes: readonly IdeaPane[],
    starts: Starts,
  ): Promise<BoundName | undefined> {
    if (panes.some((p) => p.state === "running")) {
      await starts.record(issue, "live-proof");
      return "live-proof";
    }
    return starts.held(issue);
  }
}
