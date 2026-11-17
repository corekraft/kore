import type { FileSystem } from "../runtime/index.js";
import type { WorkPiece } from "./judgment-check.js";
import { checkWork } from "./judgment-work.js";

/** Where the tick keeps each idea's work plan, under the main checkout's state, beside the session registry. */
export const PLANS_DIRECTORY = ".kore/state/tick-plans";

const IDEA = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The plan as the store writes it: the idea's issue and the checked work list. */
export interface StoredPlan {
  schema: 1;
  idea: string;
  issue: number;
  work: WorkPiece[];
}

export type PersistStatus =
  | { status: "written" }
  | { status: "same" }
  | { status: "refused"; error: string };

/**
 * One checked work plan per idea, in a file of its own. The ledger refuses free text such as a brief,
 * so the plan's body lives here and the ledger holds only the event that a plan was recorded.
 */
export class TickPlanStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly dir: string,
  ) {}

  /** The idea's persisted plan, read again through the checker; undefined when the idea has none. */
  async read(idea: string): Promise<StoredPlan | undefined> {
    const path = this.pathOf(idea);
    if (!(await this.fs.exists(path))) {
      return undefined;
    }
    const stored = JSON.parse(await this.fs.readFile(path)) as {
      idea: string;
      issue: number;
      work: unknown;
    };
    const checked = checkWork(stored.work);
    if (!checked.ok || checked.plan.kind !== "work") {
      throw new Error(
        `The persisted plan ${path} no longer checks: ${checked.ok ? "it is not a work plan" : checked.error}`,
      );
    }
    return {
      schema: 1,
      idea: stored.idea,
      issue: stored.issue,
      work: checked.plan.work,
    };
  }

  /** Writes the plan once. The same plan again writes nothing; a different one for the idea is refused. */
  async write(plan: {
    idea: string;
    issue: number;
    work: WorkPiece[];
  }): Promise<PersistStatus> {
    if (!IDEA.test(plan.idea)) {
      return {
        status: "refused",
        error: `Idea "${plan.idea}" is not a usable idea name; use lowercase letters, digits and dashes.`,
      };
    }
    const next: StoredPlan = { schema: 1, ...plan };
    const path = this.pathOf(plan.idea);
    const existing = await this.read(plan.idea);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(next)) {
        return { status: "same" };
      }
      return {
        status: "refused",
        error: `Idea ${plan.idea} already has a persisted work plan that differs from this one; nothing was changed. The owner decides whether to replace it.`,
      };
    }
    await this.fs.writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
    return { status: "written" };
  }

  private pathOf(idea: string): string {
    return `${this.dir}/${idea}.json`;
  }
}
