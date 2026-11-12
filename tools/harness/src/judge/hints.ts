import type { ChangedFile } from "./diff.js";
import type { Pattern } from "./declaration.js";

export interface FlagChange {
  flag: string;
  environment: string;
  value: boolean;
}

export type Hints = Record<string, unknown>;

const OVERLAY = /^infra\/environments\/([^/]+)\/environment\.yaml$/;
const ENTRY = /"?([\w.-]+)"?\s*:\s*(true|false)\b/g;
const INLINE = /^\s*"?features"?\s*:\s*\{(.*)\}\s*,?\s*$/;
const OPEN = /^\s*"?features"?\s*:\s*\{(.*)$/;
const CLOSE = /^[^"]*\}/;
export const NOT_BEHAVIOUR =
  /(\.md$|\.spec\.[cm]?[jt]sx?$|\.test\.[cm]?[jt]sx?$|^docs\/)/;

function entries(text: string, environment: string): FlagChange[] {
  return [...text.matchAll(ENTRY)].flatMap((m) =>
    m[1] === undefined
      ? []
      : [{ flag: m[1], environment, value: m[2] === "true" }],
  );
}

/** Flags added to the `features` object of an overlay, written inline or over several lines. */
function overlayFlags(file: ChangedFile, environment: string): FlagChange[] {
  const found: FlagChange[] = [];
  let inside = false;
  for (const { added, text } of file.after) {
    const inline = INLINE.exec(text);
    if (inline?.[1] !== undefined) {
      inside = false;
      found.push(...(added ? entries(inline[1], environment) : []));
    } else if (OPEN.test(text)) {
      inside = true;
      const rest = OPEN.exec(text)?.[1] ?? "";
      found.push(...(added ? entries(rest, environment) : []));
    } else if (inside) {
      if (CLOSE.test(text)) {
        inside = false;
      } else if (added) {
        found.push(...entries(text, environment));
      }
    }
  }
  return found;
}

/** Flags a diff adds to the environment overlays, where a feature flag is declared. */
function flagChanges(files: readonly ChangedFile[]): FlagChange[] {
  return files.flatMap((file) => {
    const environment = OVERLAY.exec(file.path)?.[1];
    return environment === undefined ? [] : overlayFlags(file, environment);
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
