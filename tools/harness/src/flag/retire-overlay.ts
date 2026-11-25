// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md

import { featuresSpan, FlagError, type Overlay } from "./overlay.js";
import { removeMember } from "./retire-remove.js";

/** A features entry as an overlay writes it: optional quote, the name, the same quote, then its boolean. */
const MEMBER = /(["']?)([a-z][a-z0-9-]*)\1(\s*:\s*)(?:true|false)\b/g;

/**
 * The overlay text with one flag's features entry removed, whether it is on or
 * off, and every other byte kept. The overlay is read again after the removal,
 * so a text left unreadable is refused and never written (ADR 0077).
 */
export function withoutFlag(overlay: Overlay, flag: string): string {
  const span = featuresSpan(overlay.text);
  const block = span === undefined ? "" : overlay.text.slice(...span);
  // Compares the captured name by string equality, so a flag named as a prefix of another never matches it.
  const entry = [...block.matchAll(MEMBER)].find((m) => m[2] === flag);
  if (span === undefined || entry === undefined) {
    throw new FlagError(
      `${overlay.path} does not declare ${flag} in its features map, so there is no entry to retire. Check the flag name, then rerun.`,
    );
  }
  const start = span[0] + (entry.index ?? 0);
  const next = removeMember(overlay.text, start, start + entry[0].length);
  try {
    JSON.parse(next);
  } catch {
    throw new FlagError(
      `Removing ${flag} would leave ${overlay.path} unreadable, so it is unchanged. Remove the entry by hand, then rerun.`,
    );
  }
  return next;
}
