// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import type { Result } from "../outcome/index.js";
import type { Clock, FileSystem } from "../runtime/index.js";
import {
  renderWindow,
  validateWindow,
  windowPath,
} from "./app-window-record.js";
import { FlagError } from "./overlay.js";

/** What the platform's activation window measured, before the writer adds the fixed kind, source and date. */
export interface AppWindowInput {
  result: Result;
  app: string;
  flag: string;
  environment: string;
  digest: string;
  commit: string;
  window: { start: Date; end: Date };
  evidence: string;
  evidenceSet: string[];
  series: { name: string; value: string }[];
  summary: string;
}

export interface WriterContext {
  /** The repository root the store's directory hangs from. */
  root: string;
  fs: FileSystem;
  clock: Clock;
}

const instant = (date: Date, edge: string): string => {
  if (Number.isNaN(date.getTime())) {
    throw new FlagError(
      `the window ${edge} is not a valid time; pass the activation window's ${edge} as a time.`,
    );
  }
  return date.toISOString();
};

/**
 * Writes one activation window's verdict as an append-only record and returns
 * its repository path. The record is created exclusively, so a second write
 * for the same window is refused and the first record is never overwritten.
 */
export async function recordAppFlagWindow(
  ctx: WriterContext,
  input: AppWindowInput,
): Promise<string> {
  const window = validateWindow(
    {
      ...input,
      kind: "verification",
      source: "platform-window",
      recorded: ctx.clock.now().toISOString().slice(0, 10),
      window: {
        start: instant(input.window.start, "start"),
        end: instant(input.window.end, "end"),
      },
    },
    `the app flag window for ${input.flag}`,
  );
  const path = windowPath(window);
  try {
    await ctx.fs.createFile(`${ctx.root}/${path}`, renderWindow(window));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new FlagError(
        `${path} already holds the app flag window for ${window.flag} in ${window.environment} from ${window.window.start} to ${window.window.end}; a window is recorded once, so this write is refused and the record is unchanged. Record a window with its own start and end.`,
      );
    }
    throw error;
  }
  return path;
}
