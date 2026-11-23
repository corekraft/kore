// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import type { Result } from "../outcome/index.js";

/** One activation window's verdict for an app flag, as the platform recorded it. */
export interface WindowRecord {
  path: string;
  flag: string;
  environment: string;
  kind: "verification";
  result: Result;
}

/**
 * The one store the platform writes app flag windows to. Its layout is a
 * design detail of the platform's writer; nothing else reads it.
 */
export interface AppFlagWindows {
  list(flag: string, environment: string): Promise<WindowRecord[]>;
}

/**
 * The window store the audit reads until the platform's writer exists. It
 * holds no records, and no file is read as a window: a hand-written file would
 * be proof the platform never made, which ADR 0174 forbids.
 */
export const UNRECORDED_WINDOWS: AppFlagWindows = {
  list: () => Promise.resolve([]),
};

/** What proof reading needs beyond the idea repository: which flags are app flags, and the windows for them. */
export interface ProofSources {
  /** A flag is an app flag when no environment overlay names it (the glossary's App flag). */
  isAppFlag(flag: string): boolean;
  windows: AppFlagWindows;
}

/** The sources when none are given: no flag is an app flag, so no window counts. */
export const NO_SOURCES: ProofSources = {
  isAppFlag: () => false,
  windows: UNRECORDED_WINDOWS,
};
