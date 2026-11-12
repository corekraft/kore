import type { Clock } from "./clock.js";
import type { FileSystem } from "./filesystem.js";
import type { Runner } from "./runner.js";

/** Everything a command may touch; real adapters in main.ts, fakes in specs. */
export interface CliDeps {
  runner: Runner;
  clock: Clock;
  fs: FileSystem;
  /**
   * Absolute path of the repository root, never the working directory.
   * Resolved on first use, so commands that need no root (--help) never fail
   * outside a repository; rejects with a named error when it cannot be found.
   */
  root(): Promise<string>;
  env: Readonly<Record<string, string | undefined>>;
  /** The process working directory (a worktree's own checkout, not the repository root). */
  cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CommandContext {
  json: boolean;
  /** Parsed flags, as the command declared them in `options`. */
  options: Record<string, string | boolean>;
  deps: CliDeps;
}

export interface Command {
  summary: string;
  /** Flags beyond the global --json and --help; a "string" flag takes a value. */
  options?: Record<string, "string" | "boolean">;
  run(context: CommandContext): Promise<number>;
}
