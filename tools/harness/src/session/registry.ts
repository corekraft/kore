import { dirname, join, resolve } from "node:path";
import { CommandError } from "../runtime/index.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";

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

  /** Resolves the main checkout from git's common dir, the way every worktree shares it. */
  static async open(deps: CliDeps): Promise<SessionRegistry> {
    const git = await deps.runner.run(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: deps.cwd },
    );
    const common = git.stdout.trim();
    if (git.code !== 0 || common === "") {
      throw new CommandError(
        `Cannot find the main checkout to keep session state in: git rev-parse --git-common-dir failed in ${deps.cwd}. Run this inside the repository.`,
      );
    }
    return new SessionRegistry(deps.fs, resolve(dirname(common), STATE_DIR));
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
}
