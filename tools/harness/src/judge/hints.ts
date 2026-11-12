import type { ChangedFile } from "./diff.js";
import type { Pattern } from "./declaration.js";

export interface FlagChange {
  flag: string;
  environment: string;
  value: boolean;
}

export type Hints = Record<string, unknown>;

const OVERLAY = /^infra\/environments\/([^/]+)\/environment\.yaml$/;
const FLAG_LINE = /^\s*"?([\w.-]+)"?\s*:\s*(true|false),?\s*$/;
const NOT_BEHAVIOUR =
  /(\.md$|\.spec\.[cm]?[jt]sx?$|\.test\.[cm]?[jt]sx?$|^docs\/)/;

/** Boolean entries added to an environment overlay, which is where a feature flag is declared. */
function flagChanges(files: readonly ChangedFile[]): FlagChange[] {
  return files.flatMap((file) => {
    const environment = OVERLAY.exec(file.path)?.[1];
    if (environment === undefined) {
      return [];
    }
    return file.added.flatMap((line) => {
      const match = FLAG_LINE.exec(line);
      return match?.[1] === undefined
        ? []
        : [{ flag: match[1], environment, value: match[2] === "true" }];
    });
  });
}

const deletedFiles = (files: readonly ChangedFile[]) =>
  files.filter((f) => f.deleted).map((f) => f.path);

const removedLines = (files: readonly ChangedFile[]) =>
  files.reduce((sum, f) => sum + f.removed, 0);

const BUILDERS: Record<Pattern, (files: readonly ChangedFile[]) => Hints> = {
  "no-behaviour-change": (files) => {
    const behaviouralPaths = files
      .map((f) => f.path)
      .filter((p) => !NOT_BEHAVIOUR.test(p));
    return {
      behaviouralPaths,
      noBehaviouralDiff: behaviouralPaths.length === 0,
    };
  },
  "feature-flagged": (files) => {
    const flags = flagChanges(files);
    return {
      flags,
      flagPresentAndOff: flags.length > 0 && flags.every((f) => !f.value),
    };
  },
  "dark-launched": (files) => {
    const flags = flagChanges(files);
    const on = flags.filter((f) => f.value);
    return {
      flags,
      flagOnlyInLocal:
        on.length > 0 && on.every((f) => f.environment === "local"),
    };
  },
  "branch-by-abstraction": (files) => {
    const deleted = deletedFiles(files);
    return { deletedFiles: deleted, oldPathRetained: deleted.length === 0 };
  },
  "expand-contract": (files) => {
    const removed = removedLines(files);
    return {
      removedLines: removed,
      deletedFiles: deletedFiles(files),
      additiveOnly: removed === 0,
    };
  },
};

/** Facts a judge needs to check the declared pattern against the diff; hints, not a verdict. */
export function hintsFor(
  pattern: Pattern,
  files: readonly ChangedFile[],
): Hints {
  return BUILDERS[pattern](files);
}
