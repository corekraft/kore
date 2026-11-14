// The vision check on the tracked tree: vision.md's text and each ADR's frontmatter status.
// Docs: infra/plans/4-knowledge.md#step-3-knowledge-health-check

import { adrLookup } from "./adr-status.js";
import type { Finding } from "./markdown.js";
import { VISION, VisionCheck } from "./vision-check.js";

/** Findings for vision.md's Decisions, or none when vision.md is not tracked. */
export function visionProblems(
  files: readonly string[],
  read: (path: string) => string | null,
): Finding[] {
  const text = files.includes(VISION) ? read(VISION) : null;
  return text === null
    ? []
    : new VisionCheck(adrLookup(files, read)).check(text);
}
