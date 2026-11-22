// Which lines of a document a harness command check reads: all of a current document, the open steps of a
// plan, and none of history (ideas, retros, and superseded ADRs).
// Docs: infra/plans/17-harness-help-guide.md#step-1-help-guide

import { frontmatter, proseLines } from "./markdown.js";

const PLAN = /^infra\/plans\/[^/]+\.md$/;
const ADR = /^docs\/decisions\/[^/]+\.md$/;
const HISTORY = /^docs\/(?:ideas|retros)\//;
const STEP = /^#{2,3}\s+Step\s+\d/;
const HEADING = /^(#{1,6})\s/;
const OPEN_BOX = /^\s*[-*] \[ \]/;

/** The lines of a plan's steps that still have an unchecked box; a step with every box ticked is closed. */
function openStepLines(text: string): Set<number> {
  const open = new Set<number>();
  let lines: number[] = [];
  let level = 0;
  let unchecked = false;
  const close = () => {
    if (unchecked) {
      lines.forEach((line) => open.add(line));
    }
    lines = [];
    level = 0;
    unchecked = false;
  };
  for (const { line, text: prose } of proseLines(text)) {
    const heading = HEADING.exec(prose);
    if (heading) {
      if (level > 0 && (heading[1]?.length ?? 0) <= level) {
        close();
      }
      if (STEP.test(prose)) {
        level = heading[1]?.length ?? 0;
        lines = [line];
      }
      continue;
    }
    if (level > 0) {
      lines.push(line);
      unchecked = unchecked || OPEN_BOX.test(prose);
    }
  }
  close();
  return open;
}

/** Whether a line of the document is one whose harness commands are checked. */
export function checkedLines(
  file: string,
  text: string,
): (line: number) => boolean {
  if (HISTORY.test(file)) {
    return () => false;
  }
  if (PLAN.test(file)) {
    const open = openStepLines(text);
    return (line) => open.has(line);
  }
  if (
    ADR.test(file) &&
    frontmatter(file, text)?.keys.get("status")?.value === "superseded"
  ) {
    return () => false;
  }
  return () => true;
}
