// Plan-file parser shared by `plan active` and, later, the context hook port.
// Behaviour mirrors .claude/hooks/context.mjs; pure functions over Markdown text.

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

/** Group a Markdown list into items, joining wrapped lines. */
export function listItems(markdown: string): ListItem[] {
  const items: ListItem[] = [];
  let heading = "";
  let current: ListItem | null = null;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      heading = line.slice(3).trim();
    }
    if (line.startsWith("- ")) {
      current = { heading, text: line.trim() };
      items.push(current);
    } else if (current && /^\s+\S/.test(line)) {
      current.text += ` ${line.trim()}`;
    } else {
      current = null;
    }
  }
  return items;
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

/** The plan's `Next:` line and the step it sits under, or null. */
export function nextStep(markdown: string): NextStep | null {
  let heading = "";
  let next: NextStep | null = null;
  for (const line of markdown.split("\n")) {
    if (next) {
      if (!line.trim() || line.startsWith("#")) {
        break;
      }
      next.text += ` ${line.trim()}`;
    } else if (line.startsWith("## ")) {
      heading = line.slice(3).trim();
    } else if (line.startsWith("Next:")) {
      next = { step: heading, text: line.slice(5).trim() };
    }
  }
  return next;
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
