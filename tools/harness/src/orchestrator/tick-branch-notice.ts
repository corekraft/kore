import { HarnessCliError } from "./harness-cli.js";
import type { TickNotifier } from "./tick-notify.js";
import type { IdeaPane, IdeaStep } from "./tick.js";

/** The seven characters of a head commit a notice's key and text name. */
const HEAD_LENGTH = 7;

/** The two triggers a notice fires on (#980): the PR conflicts with main, or it is ready but behind. */
export type BranchTrigger = "conflict" | "behind-and-ready";

const REASON: Record<BranchTrigger, string> = {
  conflict: "conflicts with main",
  "behind-and-ready": "is ready to merge but is behind main",
};

/**
 * The one signed follow-up the tick sends a writer (the branch update notice): it repeats the writer's
 * rule, never rebase or force-push, and asks for the pinned reply as the RESULT line when a live proof
 * is pinned to the head. It is one line, since `session send` refuses a message that spans lines.
 */
export function branchNoticeBody(trigger: BranchTrigger, pr: number): string {
  return `Branch update notice: PR #${pr} ${REASON[trigger]}. Merge origin/main into your branch and push it; never rebase or force-push. If your brief pins a live proof to your head, reply with exactly \`pinned: no change\` as your RESULT line and stop.`;
}

/** The dedupe key of a notice: the PR, its head and main's head, so one head pair is noticed once. */
export function branchNoticeKey(
  pr: number,
  head: string,
  main: string,
): string {
  return `branch-notice:${pr}:${head.slice(0, HEAD_LENGTH)}:${main.slice(0, HEAD_LENGTH)}`;
}

/** The ports a branch notice reads and writes: GitHub reads, the pane list, the dedupe record, and delivery. */
export interface BranchPorts {
  /** The idea's pull request, read-only; merged is true once it has merged. */
  delivery: (issue: number) => Promise<{ pr?: number; merged: boolean }>;
  /** Every pane the idea has had, read-only. */
  panes: (idea: string) => Promise<IdeaPane[]>;
  /** The PR's merge state as GitHub reports it (DIRTY, BEHIND, CLEAN, ...); throws when unreadable. */
  mergeState: (pr: number) => Promise<string>;
  /** Whether every check on the PR is green; throws when unreadable. */
  ciGreen: (pr: number) => Promise<boolean>;
  /** Whether the judge precheck reports a failure the writer must fix; throws when unreadable. */
  precheckFailing: (pr: number) => Promise<boolean>;
  /** The PR's head commit, read-only. */
  head: (pr: number) => Promise<string>;
  /** origin/main's head commit, read-only; throws when unreadable. */
  mainHead: () => Promise<string>;
  /** Whether a notice with this key was already recorded for the idea. */
  sent: (idea: string, key: string) => Promise<boolean>;
  /** Sends the notice to the writer session through `session send`; an error message, or undefined once delivered. */
  send: (writer: string, body: string) => Promise<string | undefined>;
  /** Records the sent notice under its key, so a restart sends nothing twice. */
  record: (event: {
    idea: string;
    key: string;
    writer: string;
  }) => Promise<void>;
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/** A read the tick reports rather than fails on: an expected HarnessCliError becomes a reason; anything else is rethrown. */
async function readOr<T>(read: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    if (!(error instanceof HarnessCliError)) {
      throw error;
    }
    return { ok: false, error: error.message };
  }
}

/** What the PR's state decides: a trigger to notify on, or a report to say instead of notifying. */
type Decision = { trigger: BranchTrigger } | { report: string };

/**
 * Tells a writer once, per PR head and main head, to merge origin/main when its PR conflicts with main
 * or is ready to merge but behind it. The notice goes only to a writer whose pane is live, and the tick
 * never pushes, updates or merges the branch itself (#980). A check returns what to report, or nothing.
 */
export class BranchNotice {
  constructor(private readonly ports: BranchPorts) {}

  /** The report for this idea's pass, or undefined when there is nothing to say. */
  async check(idea: string, issue: number): Promise<string | undefined> {
    const delivery = await this.ports.delivery(issue);
    if (delivery.pr === undefined || delivery.merged) {
      return undefined;
    }
    const pr = delivery.pr;
    const state = await readOr(() => this.ports.mergeState(pr));
    if (!state.ok) {
      return `PR #${pr}: its merge state is unreadable (${state.error}); no notice was sent.`;
    }
    const decision = await this.decide(pr, state.value);
    if (decision === undefined) {
      return undefined;
    }
    return "report" in decision
      ? decision.report
      : this.notify(idea, pr, decision.trigger);
  }

  /** The trigger the merge state gives, a report when the readiness is unreadable, or undefined to leave the PR alone. */
  private async decide(
    pr: number,
    state: string,
  ): Promise<Decision | undefined> {
    if (state === "DIRTY") {
      return { trigger: "conflict" };
    }
    if (state !== "BEHIND") {
      return undefined;
    }
    const ci = await readOr(() => this.ports.ciGreen(pr));
    if (!ci.ok) {
      return {
        report: `PR #${pr}: its CI is unreadable (${ci.error}); no notice was sent.`,
      };
    }
    if (!ci.value) {
      return undefined;
    }
    const failing = await readOr(() => this.ports.precheckFailing(pr));
    if (!failing.ok) {
      return {
        report: `PR #${pr}: the judge precheck is unreadable (${failing.error}); no notice was sent.`,
      };
    }
    return failing.value ? undefined : { trigger: "behind-and-ready" };
  }

  private async notify(
    idea: string,
    pr: number,
    trigger: BranchTrigger,
  ): Promise<string | undefined> {
    const head = await this.ports.head(pr);
    const main = await readOr(() => this.ports.mainHead());
    if (!main.ok) {
      return `PR #${pr}: origin/main's head is unreadable (${main.error}); no notice was sent.`;
    }
    const key = branchNoticeKey(pr, head, main.value);
    if (await this.ports.sent(idea, key)) {
      return undefined;
    }
    const writer = (await this.ports.panes(idea)).find(
      (p) => p.state === "running" && p.name.includes("-writer"),
    );
    if (writer === undefined) {
      return `PR #${pr} ${REASON[trigger]}, but no writer pane is live, so no notice was sent; the owner or the main session tells the writer.`;
    }
    const error = await this.ports.send(
      writer.name,
      branchNoticeBody(trigger, pr),
    );
    if (error !== undefined) {
      return `PR #${pr}: the notice to ${writer.name} was not sent: ${error}`;
    }
    await this.ports.record({ idea, key, writer: writer.name });
    return `Branch update notice sent to ${writer.name} for PR #${pr} (${trigger}).`;
  }
}

/**
 * Tells each step's idea what the pass needs: the attended-pane line first, then the branch update
 * notice, whose report goes on the step (#980). It is the notifier a pass already calls per step, so
 * the tick's constructor keeps its shape.
 */
export class BranchStepNotifier implements Pick<TickNotifier, "notify"> {
  constructor(
    private readonly notifier: Pick<TickNotifier, "notify">,
    private readonly branches: Pick<BranchNotice, "check">,
  ) {}

  async notify(step: IdeaStep): Promise<void> {
    await this.notifier.notify(step);
    if (step.issue === undefined) {
      return;
    }
    const notice = await this.branches.check(step.idea, step.issue);
    if (notice !== undefined) {
      step.notice = notice;
    }
  }
}
