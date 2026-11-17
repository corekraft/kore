import type { FileSystem, Runner } from "../runtime/index.js";
import { signedBody } from "../sender/index.js";
import type { WorkPiece } from "./judgment-check.js";
import { HarnessCli, HarnessCliError } from "./harness-cli.js";
import { TickPlanStore, type StoredPlan } from "./tick-plan-store.js";
import type { IdeaPane, PaneState } from "./tick.js";

const HARNESS = "skills/bin/harness.mjs";

/** The line `session wait` ends with when no result marker has shown yet: the pane is still working. */
const STILL_WORKING = "printed no";

/** The verdict line `review post` writes, with the head it reviewed. */
const VERDICT = /principles-review:[^\n]*\(head ([0-9a-f]{7,40})\)/gi;

/** The label an idea whose judgment flow stopped carries, for the owner to decide (ADR 0121). */
const NEEDS_INFO = "needs-info";

/** The tick signs what it posts as itself, so its comment is never read as the owner's (ADR 0121). */
const TICK_ENV = { KORE_ROLE: "tick", KORE_AGENT: "orchestrator-tick" };
const TICK_COMMAND = "orchestrate tick";

/** The tick's ports over the real tools: the stage tools of HarnessCli plus three read-only reads. */
export class TickCli extends HarnessCli {
  constructor(
    runner: Runner,
    private readonly repo: string,
    private readonly fs: FileSystem,
    /** The main checkout's session registry, one JSON file per spawned pane. */
    private readonly sessions: string,
    /** The main checkout's persisted work plans, one JSON file per idea (ADR 0121). */
    private readonly plans: string,
  ) {
    super(runner, repo);
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

  /** The idea's panes from the session registry; an open one is asked once for its result. */
  async panes(idea: string): Promise<IdeaPane[]> {
    const prefix = `idea-${idea}-`;
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
