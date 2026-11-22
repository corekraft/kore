import { join, resolve } from "node:path";
import { CommandError, mainRoot } from "../runtime/index.js";
import type { CliDeps, FileSystem } from "../runtime/index.js";
import type { Worktree } from "./worktree.js";

export interface SessionResult {
  outcome: "done" | "blocked";
  at: string;
  /**
   * The text the pane printed before its RESULT line, plain and capped (ADR 0123).
   * Absent on a result recorded before summaries existed.
   */
  summary?: string;
}

/** The record version this harness writes and reads. A record with no version predates versioning. */
export const SESSION_RECORD_VERSION = 1;

/** The backends a session can run on. A record with no backend is herdr: every record written before the field. */
export const BACKENDS = ["herdr", "hc"] as const;
export type Backend = (typeof BACKENDS)[number];

const isBackend = (value: unknown): value is Backend =>
  BACKENDS.some((backend) => backend === value);

/** What `session spawn` knows about a session it started, kept so wait and close can find it. */
export interface SessionRecord {
  /** Absent on a record written before versioning. The herdr path writes none. */
  version?: number;
  /** Absent means herdr. */
  backend?: Backend;
  name: string;
  paneId: string;
  /** hc only: the terminal the session runs in (its id, such as `t7`). */
  terminal?: string;
  /** Herdr only: the pane that spawned it, and the only pane that may close it. hc records have a parent instead. */
  callerPane?: string;
  /** The idea the session works, as the ledger keys it (`#338`). */
  idea?: string;
  /** The sequence number of the last report wait consumed. */
  reportSeq?: number;
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

/** The optional fields a record may carry, when present, have the type the harness writes. */
function optionalFieldsTyped(record: Record<string, unknown>): boolean {
  return (
    (record.callerPane === undefined ||
      typeof record.callerPane === "string") &&
    (record.version === undefined || Number.isInteger(record.version)) &&
    (record.terminal === undefined || typeof record.terminal === "string") &&
    (record.idea === undefined || typeof record.idea === "string") &&
    (record.reportSeq === undefined || typeof record.reportSeq === "number")
  );
}

function isRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === "string" &&
    typeof record.paneId === "string" &&
    typeof record.model === "string" &&
    (record.backend === undefined || isBackend(record.backend)) &&
    (record.backend !== "hc" || typeof record.terminal === "string") &&
    optionalFieldsTyped(record)
  );
}

/** The version a value names when that version is newer than this harness reads; undefined otherwise. */
function newerVersion(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || !("version" in value)) {
    return undefined;
  }
  const { version } = value;
  return typeof version === "number" &&
    Number.isInteger(version) &&
    version > SESSION_RECORD_VERSION
    ? version
    : undefined;
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
    const newer = newerVersion(parsed);
    if (newer !== undefined) {
      throw new CommandError(
        `Session state ${path} was written by a newer harness (record version ${newer}; this harness reads version ${SESSION_RECORD_VERSION}). Update the harness, then retry.`,
      );
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
