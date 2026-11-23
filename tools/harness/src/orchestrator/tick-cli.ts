import type { FileSystem, Runner } from "../runtime/index.js";
import { signedBody } from "../sender/index.js";
import type { WorkPiece } from "./judgment-check.js";
import { readReport, reportPath } from "../session/index.js";
import { HarnessCli, HarnessCliError } from "./harness-cli.js";
import { TickPlanStore, type StoredPlan } from "./tick-plan-store.js";
import type { IdeaPane, PaneState } from "./tick.js";
import { ticketFlagOn } from "./tick-ticket-flag.js";

const HARNESS = "skills/bin/harness.mjs";

/** The line `session wait` ends with when no result marker has shown yet: the pane is still working. */
const STILL_WORKING = "printed no";

/** The verdict line `review post` writes, with the head it reviewed. */
const VERDICT = /principles-review:[^\n]*\(head ([0-9a-f]{7,40})\)/gi;

/** The label an idea whose judgment flow stopped carries, for the owner to decide (ADR 0121). */
const NEEDS_INFO = "needs-info";

/** The tick signs what it posts as itself, so its comment is never read as the owner's (ADR 0121). */
export const TICK_ENV = { KORE_ROLE: "tick", KORE_AGENT: "orchestrator-tick" };
export const TICK_COMMAND = "orchestrate tick";

/** The state `harness pr checks --json` printed (green, red or pending), or undefined when its output carries none. */
function checksState(stdout: string): string | undefined {
  try {
    const state = (JSON.parse(stdout) as { state?: unknown }).state;
    return typeof state === "string" ? state : undefined;
  } catch {
    return undefined;
  }
}

/** The tick's ports over the real tools: the stage tools of HarnessCli plus three read-only reads. */
export interface TickCliPaths {
  /** The main checkout's session registry, one JSON file per spawned pane. */
  sessions: string;
  /** The main checkout's persisted work plans, one JSON file per idea (ADR 0121). */
  plans: string;
  /** The checkout hc sessions run in, where their reports are written: the main checkout. */
  checkout: string;
}

export class TickCli extends HarnessCli {
  private readonly sessions: string;
  private readonly plans: string;
  private readonly checkout: string;

  constructor(
    runner: Runner,
    private readonly repo: string,
    private readonly fs: FileSystem,
    paths: TickCliPaths,
  ) {
    super(runner, repo);
    this.sessions = paths.sessions;
    this.plans = paths.plans;
    this.checkout = paths.checkout;
  }

  /** The report a finished hc session wrote in the checkout, read without consuming it; undefined when it wrote none. */
  async reportOf(
    name: string,
  ): Promise<{ summary: string; plan?: string } | undefined> {
    const report = await readReport(this.fs, reportPath(this.checkout, name));
    if (report === undefined) {
      return undefined;
    }
    return {
      summary: report.summary,
      ...(report.plan === undefined ? {} : { plan: report.plan }),
    };
  }

  /** `gh issue comment`: posts the body as one comment on the issue; the error text when gh refuses, or undefined once posted (#1431). */
  async commentIssue(issue: number, body: string): Promise<string | undefined> {
    const done = await this.runner.run(
      "gh",
      ["issue", "comment", String(issue), "--body", body],
      { cwd: this.repo },
    );
    return done.code === 0
      ? undefined
      : done.stderr.trim() || `gh exited ${done.code}`;
  }

  /** The PR's merge state as GitHub reports it (DIRTY, BEHIND, CLEAN, ...); throws when it cannot be read (#980). */
  async mergeState(pr: number): Promise<string> {
    const read = (await this.view(pr, "mergeStateStatus")) as {
      mergeStateStatus: string;
    };
    return read.mergeStateStatus;
  }

  /**
   * Whether every check on the PR is green, read through `harness pr checks --json`, which is read-only.
   * It exits 1 on red and 2 on pending, and prints the state either way, so the state is read whatever
   * the code; throws when no state is printed (#980).
   */
  async ciGreen(pr: number): Promise<boolean> {
    const done = await this.runner.run(
      "node",
      [HARNESS, "pr", "checks", String(pr), "--json"],
      { cwd: this.repo },
    );
    const state = checksState(done.stdout);
    if (state === undefined) {
      this.check(`harness pr checks ${pr}`, { ...done, code: done.code || 1 });
      throw new HarnessCliError(
        `harness pr checks ${pr} printed no state. Check \`gh auth status\`, then rerun orchestrate tick.`,
      );
    }
    return state === "green";
  }

  /** origin/main's head commit through the GitHub API; throws when it cannot be read (#980). */
  async mainHead(): Promise<string> {
    const done = await this.runner.run(
      "gh",
      ["api", "repos/{owner}/{repo}/commits/main", "--jq", ".sha"],
      { cwd: this.repo },
    );
    this.check("gh api repos/{owner}/{repo}/commits/main", done);
    const sha = done.stdout.trim();
    if (sha === "") {
      throw new HarnessCliError(
        "gh api printed no head for origin/main. Check `gh auth status`, then rerun orchestrate tick.",
      );
    }
    return sha;
  }

  /**
   * `session send <writer>`: the notice goes through the session tool, signed with the tick's sender
   * variables laid over `base` (the environment the child needs). Undefined once sent; otherwise the
   * refusal, which the pass reports and records nothing for.
   */
  async sendToWriter(
    writer: string,
    message: string,
    base: Readonly<Record<string, string>> = {},
  ): Promise<string | undefined> {
    const done = await this.runner.run(
      "node",
      [HARNESS, "session", "send", writer, "--message", message],
      { cwd: this.repo, env: { ...base, ...TICK_ENV } },
    );
    if (done.code === 0) {
      return undefined;
    }
    const reason =
      done.stderr.trim() || done.stdout.trim() || `exit ${done.code}`;
    return `Could not send to ${writer}: ${reason}. Nothing was recorded, so the next pass tries again.`;
  }

  /** The idea's persisted work plan, read through the store's checker; undefined when none is persisted. */
  workPlan(idea: string): Promise<StoredPlan | undefined> {
    return new TickPlanStore(this.fs, this.plans).read(idea);
  }

  /** `orchestrate plan`: the checked plan goes on stdin, so the brief never reaches argv (ADR 0121). */
  async persistPlan(
    idea: string,
    issue: number,
    work: readonly WorkPiece[],
  ): Promise<void> {
    const done = await this.runner.run(
      "node",
      [
        HARNESS,
        "orchestrate",
        "plan",
        "--idea",
        idea,
        "--issue",
        String(issue),
        "--json",
      ],
      { cwd: this.repo, input: JSON.stringify({ work }) },
    );
    this.check(`harness orchestrate plan ${idea}`, done);
  }

  /** Whether the local overlay turns the `tick-ticket-queue` flag on. */
  ticketsOn(): Promise<boolean> {
    return ticketFlagOn(this.fs, this.repo);
  }

  /** `gh issue view`: the issue's title, for a ticket's brief. */
  async issueTitle(issue: number): Promise<string> {
    const done = await this.runner.run(
      "gh",
      ["issue", "view", String(issue), "--json", "title"],
      { cwd: this.repo },
    );
    this.check(`gh issue view ${issue}`, done);
    return (this.json(done.stdout) as { title: string }).title;
  }

  /** `gh pr view`: the pull request's head commit. */
  async head(pr: number): Promise<string> {
    const read = await this.view(pr, "headRefOid");
    return (read as { headRefOid: string }).headRefOid;
  }

  /** Whether a principles-review verdict is already on the PR for this head (full or abbreviated). */
  async reviewPosted(pr: number, head: string): Promise<boolean> {
    const read = (await this.view(pr, "comments")) as {
      comments: { body: string }[];
    };
    return read.comments.some((comment) =>
      [...comment.body.matchAll(VERDICT)].some(
        (match) =>
          match[1] !== undefined &&
          (match[1].startsWith(head) || head.startsWith(match[1])),
      ),
    );
  }

  /** A finished judgment or reader pane's text, read through its session result before the pane closes; read-only. */
  async paneText(name: string): Promise<string> {
    return (await this.collect(name)).text;
  }

  /**
   * Labels the issue `needs-info`, then comments the reason under the tick's sender line. The
   * reason is refused, before any write, when it carries guardrail approval syntax.
   */
  async needsInfo(issue: number, reason: string): Promise<void> {
    const signed = signedBody(
      TICK_ENV,
      TICK_COMMAND,
      `Judgment on this idea stopped it: ${reason}\n\nNothing was started for it; the owner decides the next step.`,
    );
    if ("error" in signed) {
      throw new HarnessCliError(signed.error);
    }
    await this.gh(["issue", "edit", String(issue), "--add-label", NEEDS_INFO]);
    await this.gh(["issue", "comment", String(issue), "--body", signed.body]);
  }

  private async gh(args: string[]): Promise<void> {
    const done = await this.runner.run("gh", args, { cwd: this.repo });
    this.check(`gh ${args.slice(0, 2).join(" ")}`, done);
  }

  /**
   * The pane the idea's latest session was spawned from, read from the session registry; undefined
   * when no session was spawned for the idea. This is the pane a notice to the person goes to (ADR 0121).
   */
  async attendedPane(idea: string): Promise<string | undefined> {
    const prefix = `idea-${idea}-`;
    const files = await this.fs
      .readdir(this.sessions)
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      });
    let latest: { createdAt: string; callerPane: string } | undefined;
    for (const file of files.filter(
      (f) => f.startsWith(prefix) && f.endsWith(".json"),
    )) {
      const record = JSON.parse(
        await this.fs.readFile(`${this.sessions}/${file}`),
      ) as { createdAt: string; callerPane: string };
      if (latest === undefined || record.createdAt > latest.createdAt) {
        latest = record;
      }
    }
    return latest?.callerPane;
  }

  /** The idea's panes from the session registry; an open one is asked once for its result. */
  panes(idea: string): Promise<IdeaPane[]> {
    return this.panesNamed(`idea-${idea}-`);
  }

  /** Every live-proof pane the tick has started, for any ticket; read the same way as an idea's panes. */
  livePanes(): Promise<IdeaPane[]> {
    return this.panesNamed("live-proof-");
  }

  private async panesNamed(prefix: string): Promise<IdeaPane[]> {
    const files = await this.fs
      .readdir(this.sessions)
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return [];
        }
        throw error;
      });
    const panes: IdeaPane[] = [];
    for (const file of files.filter(
      (f) => f.startsWith(prefix) && f.endsWith(".json"),
    )) {
      const name = file.slice(0, -".json".length);
      panes.push({ name, state: await this.state(name, file) });
    }
    return panes;
  }

  private async state(name: string, file: string): Promise<PaneState> {
    const record = JSON.parse(
      await this.fs.readFile(`${this.sessions}/${file}`),
    ) as { closedAt?: string; result?: { outcome: "done" | "blocked" } };
    if (record.closedAt !== undefined) {
      return "closed";
    }
    if (record.result !== undefined) {
      return record.result.outcome;
    }
    // `session wait` reads the pane once and records a result it finds.
    const done = await this.runner.run(
      "node",
      [
        "skills/bin/harness.mjs",
        "session",
        "wait",
        name,
        "--timeout",
        "1",
        "--json",
      ],
      { cwd: this.repo },
    );
    if (done.code === 0) {
      return (JSON.parse(done.stdout) as { outcome: "done" | "blocked" })
        .outcome;
    }
    if (done.stderr.includes(STILL_WORKING)) {
      return "running";
    }
    this.check(`harness session wait ${name}`, done);
    throw new HarnessCliError(`Could not read the result of ${name}.`);
  }

  private async view(pr: number, field: string): Promise<unknown> {
    const done = await this.runner.run(
      "gh",
      ["pr", "view", String(pr), "--json", field],
      { cwd: this.repo },
    );
    this.check(`gh pr view ${pr}`, done);
    return this.json(done.stdout);
  }
}
