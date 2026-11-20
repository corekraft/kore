import type { RunResult, Runner } from "../runtime/index.js";

/** The ledger kind a failed harness-build writes; its label names the head and the exit code. */
export const TICK_SELF_UPDATE_FAILED = "tick.self-update-failed";

/** The loop's own files: a pull that changes one means the running loop is stale until it restarts. */
const LOOP_FILES: readonly string[] = [
  "tools/harness/src/cli/orchestrate-tick-loop.ts",
  "tools/harness/src/orchestrator/tick-loop.ts",
  "tools/harness/src/orchestrator/tick-self-update.ts",
];

const KEEPS = "The tick keeps the bundle it has.\n";

export interface SelfUpdatePorts {
  runner: Pick<Runner, "run">;
  root: string;
  /** Writes the tick.self-update-failed event; the message is its label. */
  recordFailure(message: string): Promise<void>;
  stdout(text: string): void;
  stderr(text: string): void;
}

/**
 * The step between passes that moves a clean checkout on main up to origin/main and rebuilds
 * the harness bundle. Each refusal is reported and the old bundle keeps running; a failed build
 * is recorded, and the next attempt waits until origin/main moves.
 */
export class TickSelfUpdate {
  constructor(private readonly ports: SelfUpdatePorts) {}

  async run(): Promise<void> {
    if (!(await this.preflight())) {
      return;
    }
    const before = await this.head();
    if (before === undefined) {
      return;
    }
    const pull = await this.git(["pull", "--ff-only"]);
    if (pull.code !== 0) {
      return this.failed("git pull --ff-only", pull);
    }
    const after = await this.head();
    if (after === undefined) {
      return;
    }
    await this.build(before, after);
  }

  /** Whether a clean main on a fast-forward of origin/main is behind it; reports every other refusal. */
  private async preflight(): Promise<boolean> {
    return (await this.onCleanMain()) && (await this.behindFastForward());
  }

  /** Whether the checkout is on main with a clean tree; reports the refusal otherwise. */
  private async onCleanMain(): Promise<boolean> {
    const branch = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch.code !== 0) {
      this.failed("git rev-parse --abbrev-ref HEAD", branch);
      return false;
    }
    const name = branch.stdout.trim();
    if (name !== "main") {
      this.ports.stdout(
        `The checkout is on ${name}, not main, so the tick keeps the bundle it has.\n`,
      );
      return false;
    }
    const status = await this.git(["status", "--porcelain"]);
    if (status.code !== 0) {
      this.failed("git status --porcelain", status);
      return false;
    }
    if (status.stdout.trim() !== "") {
      this.ports.stdout(
        "The checkout has uncommitted changes, so the tick did not update main and keeps the bundle it has.\n",
      );
      return false;
    }
    return true;
  }

  /** Whether origin/main is ahead and this checkout is a fast-forward of it; reports a failed fetch or a refusal. */
  private async behindFastForward(): Promise<boolean> {
    const fetch = await this.git(["fetch", "--quiet", "origin", "main"]);
    if (fetch.code !== 0) {
      this.failed("git fetch --quiet origin main", fetch);
      return false;
    }
    const behind = await this.git(["rev-list", "--count", "HEAD..origin/main"]);
    if (behind.code !== 0) {
      this.failed("git rev-list --count HEAD..origin/main", behind);
      return false;
    }
    if (Number(behind.stdout.trim()) === 0) {
      return false;
    }
    const ancestor = await this.git([
      "merge-base",
      "--is-ancestor",
      "HEAD",
      "origin/main",
    ]);
    if (ancestor.code !== 0) {
      this.ports.stderr(
        `origin/main is not a fast-forward of this checkout, so the tick did not pull it and keeps the bundle it has.\n`,
      );
      return false;
    }
    return true;
  }

  private async build(before: string, after: string): Promise<void> {
    const changed = await this.git(["diff", "--name-only", before, after]);
    const build = await this.ports.runner.run(
      "mise",
      ["run", "harness-build"],
      {
        cwd: this.ports.root,
      },
    );
    if (build.code !== 0) {
      const label = `harness-build failed at ${after} with exit ${build.code}`;
      await this.ports.recordFailure(label);
      return this.ports.stderr(
        `The harness-build after the pull to ${after} failed with exit ${build.code}${detail(build.stderr)}The tick keeps the bundle it has and waits for origin/main to move.\n`,
      );
    }
    const loopChanged = changed.stdout
      .split("\n")
      .some((file) => LOOP_FILES.includes(file));
    this.ports.stdout(
      `Updated main to ${after} and rebuilt the harness bundle.\n`,
    );
    if (loopChanged) {
      this.ports.stdout(
        "The tick loop changed; restart orchestrate tick --loop to run the new loop.\n",
      );
    }
  }

  private async head(): Promise<string | undefined> {
    const head = await this.git(["rev-parse", "HEAD"]);
    if (head.code !== 0) {
      this.failed("git rev-parse HEAD", head);
      return undefined;
    }
    return head.stdout.trim();
  }

  private failed(label: string, result: RunResult): void {
    this.ports.stderr(
      `${label} failed with exit ${result.code}${detail(result.stderr)}${KEEPS}`,
    );
  }

  private git(args: string[]): Promise<RunResult> {
    return this.ports.runner.run("git", args, { cwd: this.ports.root });
  }
}

/** The stderr of a failed command, on the line after its label; nothing when it printed none. */
function detail(stderr: string): string {
  const text = stderr.trim();
  return text === "" ? "\n" : `: ${text}\n`;
}
