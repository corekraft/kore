import type { Clock } from "./clock.js";
import type { FileSystem } from "./filesystem.js";
import type { HostLoad } from "./host-load.js";
import type { IdSource } from "./ids.js";
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
  ids: IdSource;
  /** A uniform draw in [0, 1) for sampling a launch; absent in fakes that sample nothing, so nothing is sampled. */
  random?: () => number;
  /** The host load average; absent in fakes that no load check reads. */
  hostLoad?: HostLoad;
  /**
   * `import.meta.url` of the running bundle. A command that must not be steered by the
   * environment finds the checkout from it instead of from KORE_ROOT or CLAUDE_PROJECT_DIR.
   */
  bundleUrl?: string;
  env: Readonly<Record<string, string | undefined>>;
  /** The host's operating system; absent in fakes, which stand for macOS. */
  platform?: NodeJS.Platform;
  /** The process working directory (a worktree's own checkout, not the repository root). */
  cwd: string;
  /** Reads all of standard input as text. */
  stdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CommandContext {
  json: boolean;
  /** Parsed flags, as the command declared them in `options`. */
  options: Record<string, string | boolean>;
  /**
   * Repeatable flags, as the command declared them as "list": every value given, in
   * order. Present only when the command was given at least one such flag.
   */
  lists?: Record<string, string[]>;
  /** The one positional argument, for a command that declares an `operand`. */
  operand?: string | undefined;
  deps: CliDeps;
}

export interface Command {
  summary: string;
  /**
   * Flags beyond the global --json and --help. A "string" flag takes a value; a "list"
   * flag takes a value and may be repeated, and each value is kept in order in `lists`.
   */
  options?: Record<string, "string" | "boolean" | "list">;
  /** Names the one positional argument the command takes, such as "name". */
  operand?: string;
  run(context: CommandContext): Promise<number>;
}
