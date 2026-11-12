import { join, resolve } from "node:path";
import { CommandError, mainRoot } from "../runtime/index.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import type { Worktree } from "./worktree.js";

export interface SessionResult {
  outcome: "done" | "blocked";
  at: string;
}

/** What `session spawn` knows about a pane it created, kept so wait and close can find it. */
export interface SessionRecord {
  name: string;
  paneId: string;
  /** The pane that spawned it; only that pane may close it. */
  callerPane: string;
  model: string;
  role: string;
  effort: string;
  /** Set when spawned with --worktree: where it works and on which branch. */
  worktree?: Worktree;
  createdAt: string;
  result?: SessionResult;
  closedAt?: string;
}

const STATE_DIR = ".kore/state/sessions";

function isRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.paneId === "string" &&
    typeof record.callerPane === "string" &&
    typeof record.model === "string"
  );
}

/**
 * One JSON file per spawned session under the main checkout's .kore/state, so
 * parallel sessions in any worktree never write the same file.
 */
export class SessionRegistry {
  private constructor(
    private readonly fs: FileSystem,
    private readonly dir: string,
  ) {}

  /** Keeps state in the main checkout, shared by every worktree (see `mainRoot`). */
  static async open(deps: CliDeps): Promise<SessionRegistry> {
    const main = await mainRoot(deps);
    if (main === undefined) {
      throw new CommandError(
        "Cannot find the main checkout to keep session state in. Run inside the repository or set KORE_ROOT to its root.",
      );
    }
    return new SessionRegistry(deps.fs, resolve(main, STATE_DIR));
  }

  private file(name: string): string {
    return join(this.dir, `${name}.json`);
  }

  async read(name: string): Promise<SessionRecord | undefined> {
    const path = this.file(name);
    if (!(await this.fs.exists(path))) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await this.fs.readFile(path));
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      parsed = undefined;
    }
    if (!isRecord(parsed)) {
      throw new CommandError(
        `Session state ${path} is not a valid session record; delete it and spawn the session again.`,
      );
    }
    return parsed;
  }

  async write(record: SessionRecord): Promise<void> {
    await this.fs.writeFile(
      this.file(record.name),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }

  /** Why `name` cannot be spawned again: its record exists and is not closed. Undefined when free. */
  async unavailable(name: string): Promise<string | undefined> {
    const existing = await this.read(name);
    return existing === undefined || existing.closedAt !== undefined
      ? undefined
      : `A session record for ${name} (pane ${existing.paneId}) already exists and is not closed; run \`session wait ${name}\` then \`session close ${name}\`, or pick another name. No pane was split.`;
  }

  /** Records a new session; refuses to replace one that is not closed, even under a race. */
  async create(record: SessionRecord): Promise<void> {
    const content = `${JSON.stringify(record, null, 2)}\n`;
    try {
      await this.fs.createFile(this.file(record.name), content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const reason = await this.unavailable(record.name);
      if (reason !== undefined) {
        throw new CommandError(
          reason.replace(
            " No pane was split.",
            ` Pane ${record.paneId} is running unrecorded; close it with \`herdr pane close ${record.paneId}\`.`,
          ),
        );
      }
      await this.write(record);
    }
  }
}
