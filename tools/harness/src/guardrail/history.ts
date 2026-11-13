// A rule's mode over the inventory's git history, read through the injectable
// runner. The ledger records that a person was asked; git records what they
// decided, so approval is never inferred from the ledger alone (ADR 0080).
import type { Runner } from "../runtime/index.js";
import { INVENTORY_PATH, GuardrailError, parseInventory } from "./inventory.js";
import type { Target } from "./requests.js";

/** A cap on the commits read: enough for any rule's recent history, and never unbounded. */
const MAX_COMMITS = 200;

interface Commit {
  sha: string;
  at: string;
}

/** A rule's mode in one commit: "removed" when the rule is not listed. */
type State = string;

export class ModeHistory {
  constructor(
    private readonly runner: Runner,
    private readonly root: string,
  ) {}

  /** Commits that touched the inventory, newest first; empty when git cannot answer. */
  private async commits(): Promise<Commit[]> {
    const log = await this.runner.run(
      "git",
      [
        "log",
        `--max-count=${MAX_COMMITS}`,
        "--format=%H %cI",
        "--",
        INVENTORY_PATH,
      ],
      { cwd: this.root },
    );
    if (log.code !== 0) {
      return [];
    }
    return log.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => {
        const [sha = "", at = ""] = line.trim().split(" ");
        return { sha, at };
      });
  }

  /** The rule's state at a commit, or undefined when the file cannot be read there. */
  private async stateAt(sha: string, rule: string): Promise<State | undefined> {
    const shown = await this.runner.run(
      "git",
      ["show", `${sha}:${INVENTORY_PATH}`],
      {
        cwd: this.root,
      },
    );
    if (shown.code !== 0) {
      return undefined;
    }
    try {
      const found = parseInventory(shown.stdout).guardrails.find(
        (g) => g.rule === rule,
      );
      return found?.mode ?? "removed";
    } catch (error) {
      if (error instanceof GuardrailError) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The day (YYYY-MM-DD) the rule entered its current mode: the oldest commit
   * of the unbroken run in that mode. Undefined when git cannot say, or when
   * the newest commit holds another mode (the change is not committed yet).
   */
  async enteredMode(rule: string, mode: string): Promise<string | undefined> {
    let entered: string | undefined;
    for (const commit of await this.commits()) {
      if ((await this.stateAt(commit.sha, rule)) !== mode) {
        break;
      }
      entered = commit.at.slice(0, 10);
    }
    return entered;
  }

  /** Whether any commit at or after `since` (an ISO time) held the requested state. */
  async reached(rule: string, to: Target, since: string): Promise<boolean> {
    const wanted: State = to === "remove" ? "removed" : to;
    const from = Date.parse(since);
    for (const commit of await this.commits()) {
      if (Date.parse(commit.at) < from) {
        break;
      }
      if ((await this.stateAt(commit.sha, rule)) === wanted) {
        return true;
      }
    }
    return false;
  }
}
