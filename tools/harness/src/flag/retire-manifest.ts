// Docs: docs/decisions/0149-a-feature-flag-retires-after-it-soaks-on-in-every-environment-it-applies-to.md

import { FLAG_MANIFEST } from "./requirements.js";
import { FlagError } from "./overlay.js";
import { removeMember } from "./retire-remove.js";

type Span = [number, number];

/**
 * The span of every object that is a direct element of the manifest's flags
 * array, found by one string-aware pass. The array sits one level inside the
 * root object, so its elements open at depth two.
 */
function entrySpans(text: string): Span[] {
  const stack: { open: string; start: number }[] = [];
  const spans: Span[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inString) {
      if (c === "\\") {
        i++;
      } else if (c === '"') {
        inString = false;
      }
    } else if (c === '"') {
      inString = true;
    } else if (c === "{" || c === "[") {
      stack.push({ open: c, start: i });
    } else if (c === "}" || c === "]") {
      const top = stack.pop();
      if (top?.open === "{" && stack.length === 2 && stack[1]?.open === "[") {
        spans.push([top.start, i + 1]);
      }
    }
  }
  return spans;
}

/** The name an entry's text declares, or undefined when it does not parse or names no string. */
function nameOf(entry: string): unknown {
  try {
    return (JSON.parse(entry) as { name?: unknown }).name;
  } catch {
    return undefined;
  }
}

/**
 * The manifest text with one flag's entry removed and every other byte kept.
 * Entries that only name the flag in their requires are left in place: they
 * are references the retirement prints for the writer to delete. A text the
 * removal would leave unreadable is refused, so the file is never written
 * broken (ADR 0148).
 */
export function withoutManifestEntry(text: string, flag: string): string {
  for (const [start, end] of entrySpans(text)) {
    if (nameOf(text.slice(start, end)) !== flag) {
      continue;
    }
    const next = removeMember(text, start, end);
    try {
      JSON.parse(next);
    } catch {
      throw new FlagError(
        `Removing ${flag} would leave ${FLAG_MANIFEST} unreadable, so it is unchanged. Remove the entry by hand, then rerun.`,
      );
    }
    return next;
  }
  throw new FlagError(
    `${FLAG_MANIFEST} does not declare ${flag}, so there is no entry to retire. Check the flag name, then rerun.`,
  );
}
