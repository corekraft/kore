// Plan-file parser shared by `plan active`, `plan next`, `plan tick` and the
// context hook; pure functions over Markdown text.

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const UPCOMING_STEPS = 3;

export interface ListItem {
  heading: string;
  text: string;
}
export interface StepCount {
  step: string;
  count: number;
}
export interface NextStep {
  step: string;
  text: string;
}

function planNumber(name: string): number {
  return Number.parseInt(name, 10);
}

/** The frontmatter `status:` value, or undefined without frontmatter or status. */
export function planStatus(markdown: string): string | undefined {
  const frontmatter = FRONTMATTER.exec(markdown)?.[1];
  return frontmatter === undefined
    ? undefined
    : /^status: *(\S*) *$/m.exec(frontmatter)?.[1];
}

export interface ItemSpan extends ListItem {
  /** Zero-based index of the item's first line. */
  line: number;
  /** Zero-based index one past the item's last wrapped line. */
  end: number;
}

/** Group a Markdown list into items, joining wrapped lines, with their line spans. */
export function listItemSpans(markdown: string): ItemSpan[] {
  const items: ItemSpan[] = [];
  let heading = "";
  let current: ItemSpan | null = null;
  for (const [index, line] of markdown.split("\n").entries()) {
    if (line.startsWith("## ")) {
      heading = line.slice(3).trim();
    }
    if (line.startsWith("- ")) {
      current = { heading, text: line.trim(), line: index, end: index + 1 };
      items.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`;
      current.end = index + 1;
    } else {
      current = null;
    }
  }
  return items;
}

/** Group a Markdown list into items, joining wrapped lines. */
export function listItems(markdown: string): ListItem[] {
  return listItemSpans(markdown).map(({ heading, text }) => ({
    heading,
    text,
  }));
}

/** Unchecked plan items, each prefixed with the step heading it belongs to. */
export function openItems(markdown: string): string[] {
  return listItems(markdown)
    .filter((item) => item.text.startsWith("- [ ]"))
    .map((item) => `${item.heading}: ${item.text}`);
}

function openSteps(markdown: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of listItems(markdown)) {
    if (!item.text.startsWith("- [ ]")) {
      continue;
    }
    counts.set(item.heading, (counts.get(item.heading) ?? 0) + 1);
  }
  return counts;
}

/** Open item counts per step, in plan order; `step` is the heading before its first colon. */
export function openCounts(markdown: string): StepCount[] {
  return [...openSteps(markdown)].map(([heading, count]) => ({
    step: heading.split(":")[0] ?? heading,
    count,
  }));
}

export interface NextBlock extends NextStep {
  /** Zero-based index of the `Next:` line. */
  line: number;
  /** Zero-based index one past the paragraph's last wrapped line. */
  end: number;
}

const FENCE = /^\s*(```|~~~)/;
const LIST_MARKER = /^\s*([-*+]|\d+\.)\s/;

/**
 * Every `Next:` paragraph with the step it sits under. A paragraph runs to the
 * next blank line, heading, list item or code fence; lines inside a code fence
 * are never read.
 */
export function nextBlocks(markdown: string): NextBlock[] {
  const lines = markdown.split("\n");
  const blocks: NextBlock[] = [];
  let heading = "";
  let fenced = false;
  let open: NextBlock | null = null;
  for (const [index, line] of lines.entries()) {
    const fence = FENCE.test(line);
    const stops =
      fence || !line.trim() || line.startsWith("#") || LIST_MARKER.test(line);
    if (open && !fenced && !stops) {
      open.text += ` ${line.trim()}`;
      open.end = index + 1;
      continue;
    }
    open = null;
    if (fence) {
      fenced = !fenced;
    } else if (!fenced && line.startsWith("## ")) {
      heading = line.slice(3).trim();
    } else if (!fenced && line.startsWith("Next:")) {
      open = {
        step: heading,
        text: line.slice(5).trim(),
        line: index,
        end: index + 1,
      };
      blocks.push(open);
    }
  }
  return blocks;
}

/** The plan's first `Next:` line and the step it sits under, or null. */
export function nextStep(markdown: string): NextStep | null {
  const first = nextBlocks(markdown)[0];
  return first ? { step: first.step, text: first.text } : null;
}

/**
 * Titles of the next steps with open items after the current one: the step
 * holding the `Next:` line, or else the first step with open items.
 */
export function upcomingSteps(markdown: string): string[] {
  const open = [...openSteps(markdown).keys()];
  const current = nextStep(markdown)?.step ?? open[0];
  const headings = markdown
    .split("\n")
    .filter((line) => line.startsWith("## "))
    .map((line) => line.slice(3).trim());
  const after = headings.slice(headings.indexOf(current ?? "") + 1);
  return after
    .filter((heading) => open.includes(heading))
    .slice(0, UPCOMING_STEPS);
}

/**
 * Every plan the session brief covers, highest-numbered first: each plan whose
 * frontmatter says `status: active`, plus the highest-numbered plan without
 * frontmatter that still has open items.
 */
export function activePlans(plans: Record<string, string>): string[] {
  const active: string[] = [];
  let legacy: string | undefined;
  const byNumber = Object.keys(plans).sort(
    (a, b) => planNumber(b) - planNumber(a),
  );
  for (const name of byNumber) {
    const markdown = plans[name] ?? "";
    if (!FRONTMATTER.test(markdown)) {
      if (legacy === undefined && openItems(markdown).length > 0) {
        legacy = name;
      }
    } else if (planStatus(markdown) === "active") {
      active.push(name);
    }
  }
  if (legacy !== undefined) {
    active.push(legacy);
  }
  return active.sort((a, b) => planNumber(b) - planNumber(a));
}
