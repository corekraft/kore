import type { FileSystem } from "../runtime/index.js";
import { HarnessCliError } from "./harness-cli.js";
import type { LeaseRecord, LeaseStore } from "./tick-lease.js";

type LeaseFiles = Pick<
  FileSystem,
  "createFile" | "writeFile" | "readFile" | "exists" | "remove"
>;

/** The tick lease as one file in the host lock directory, shared by every worktree on the machine. */
export class FileLeaseStore implements LeaseStore {
  constructor(
    private readonly fs: LeaseFiles,
    private readonly path: string,
  ) {}

  async read(): Promise<LeaseRecord | undefined> {
    if (!(await this.fs.exists(this.path))) {
      return undefined;
    }
    try {
      const record = JSON.parse(
        await this.fs.readFile(this.path),
      ) as Partial<LeaseRecord>;
      if (
        typeof record.token === "string" &&
        typeof record.pid === "number" &&
        typeof record.host === "string" &&
        typeof record.acquiredAt === "string" &&
        !Number.isNaN(Date.parse(record.acquiredAt))
      ) {
        return record as LeaseRecord;
      }
    } catch {
      // Falls through to the actionable error below.
    }
    throw new HarnessCliError(
      `${this.path} is not a tick lease; if no tick is running, remove it, then rerun.`,
    );
  }

  async create(record: LeaseRecord): Promise<boolean> {
    try {
      await this.fs.createFile(this.path, `${JSON.stringify(record)}\n`);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  async overwrite(record: LeaseRecord): Promise<void> {
    await this.fs.writeFile(this.path, `${JSON.stringify(record)}\n`);
  }

  async remove(): Promise<void> {
    await this.fs.remove(this.path);
  }
}
