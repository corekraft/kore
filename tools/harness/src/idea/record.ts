export const SAFETY_PATTERNS = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
  "expand-contract",
] as const;

export interface IdeaRecord {
  number: string;
  slug: string;
  path: string;
  title: string;
  summary: string;
  hypothesis: string;
  expectedOutcome: string;
  measurement: string;
  safetyPattern: string;
  date: string;
  outcome?: string;
  issue?: string;
  parent?: string;
}

export class IdeaError extends Error {}

export const IDEA_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/** Frontmatter key for each required record field, in file order. */
const REQUIRED = [
  ["summary", "summary"],
  ["hypothesis", "hypothesis"],
  ["expected-outcome", "expectedOutcome"],
  ["measurement", "measurement"],
  ["safety-pattern", "safetyPattern"],
  ["date", "date"],
] as const;

/** Flat `key: value` frontmatter lines, or null when the file has none. */
function frontmatter(text: string): Map<string, string> | null {
  const lines = text.split("\n");
  if (lines[0] !== "---") {
    return null;
  }
  const keys = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (line === "---") {
      return keys;
    }
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined) {
      keys.set(match[1], (match[2] ?? "").trim());
    }
  }
  return null;
}

/** Reads one idea file; throws an IdeaError naming the file and what to fix. */
export function parseIdea(path: string, text: string): IdeaRecord {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const name = IDEA_FILE.exec(file);
  if (name?.[1] === undefined || name[2] === undefined) {
    throw new IdeaError(
      `${path} is not named NNNN-slug.md; rename it to a four-digit number and a lowercase slug.`,
    );
  }
  const keys = frontmatter(text);
  if (keys === null) {
    throw new IdeaError(
      `${path} has no frontmatter; start it with --- and the idea fields (see \`harness idea new --help\`).`,
    );
  }
  const missing = REQUIRED.filter(([key]) => !keys.get(key)).map(([k]) => k);
  if (missing.length > 0) {
    throw new IdeaError(
      `${path} is missing frontmatter ${missing.join(", ")}; add each as a key: value line.`,
    );
  }
  const get = (key: string): string => keys.get(key) ?? "";
  const heading = /^# Idea \d{4}: (.+)$/m.exec(text)?.[1];
  const record: IdeaRecord = {
    number: name[1],
    slug: name[2],
    path,
    title: heading ?? get("summary"),
    summary: get("summary"),
    hypothesis: get("hypothesis"),
    expectedOutcome: get("expected-outcome"),
    measurement: get("measurement"),
    safetyPattern: get("safety-pattern"),
    date: get("date"),
  };
  for (const key of ["outcome", "issue", "parent"] as const) {
    if (get(key) !== "") {
      record[key] = get(key);
    }
  }
  return record;
}

/** A single-line frontmatter scalar, or an IdeaError naming the flag. */
export function scalar(flag: string, value: string | undefined): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text === "") {
    throw new IdeaError(`Missing --${flag}; pass a non-empty value.`);
  }
  if (/^[[{|>&*!-]/.test(text)) {
    throw new IdeaError(
      `--${flag} must not start with "${text.slice(0, 1)}"; frontmatter holds plain text, so reword it.`,
    );
  }
  return text;
}

export interface NewIdea {
  title: string;
  summary: string;
  hypothesis: string;
  expectedOutcome: string;
  measurement: string;
  safetyPattern: string;
  issue?: string;
  parent?: string;
}

/** The markdown file for a new, open idea. It holds no workflow state. */
export function renderIdea(
  number: string,
  date: string,
  idea: NewIdea,
): string {
  const lines = [
    "---",
    `summary: ${idea.summary}`,
    `hypothesis: ${idea.hypothesis}`,
    `expected-outcome: ${idea.expectedOutcome}`,
    `measurement: ${idea.measurement}`,
    `safety-pattern: ${idea.safetyPattern}`,
    `date: ${date}`,
  ];
  if (idea.issue !== undefined) {
    lines.push(`issue: ${idea.issue}`);
  }
  if (idea.parent !== undefined) {
    lines.push(`parent: ${idea.parent}`);
  }
  lines.push("---", "", `# Idea ${number}: ${idea.title}`, "");
  return lines.join("\n");
}

/** Sets the `issue:` frontmatter line, replacing any existing one; the rest of the file is untouched. */
export function withIssue(text: string, issue: string): string {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    throw new IdeaError("The idea has no frontmatter to record the issue in.");
  }
  const at = lines.findIndex(
    (l, i) => i > 0 && i < end && l.startsWith("issue:"),
  );
  if (at === -1) {
    lines.splice(end, 0, `issue: ${issue}`);
  } else {
    lines[at] = `issue: ${issue}`;
  }
  return lines.join("\n");
}

const OUTCOME_HEADING = "## Outcome";

/** The line range of the `## Outcome` section, up to the next heading; tolerant of CRLF and trailing spaces. */
function outcomeRange(lines: string[]): [number, number] | undefined {
  const start = lines.findIndex((l) => l.trimEnd() === OUTCOME_HEADING);
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
  return [start, end === -1 ? lines.length : end];
}

/** The recorded `## Outcome` section, or undefined when the idea has none. */
export function outcomeSection(text: string): string | undefined {
  const lines = text.split("\n");
  const range = outcomeRange(lines);
  return range === undefined
    ? undefined
    : lines
        .slice(...range)
        .join("\n")
        .replace(/\r/g, "")
        .trim();
}

/** The markdown without its `## Outcome` section: what the issue body renders from. */
export function withoutOutcome(text: string): string {
  const lines = text.split("\n");
  const range = outcomeRange(lines);
  return range === undefined
    ? text
    : [...lines.slice(0, range[0]), ...lines.slice(range[1])]
        .join("\n")
        .trimEnd();
}

/** Sets the `outcome:` frontmatter line and appends the outcome section; the rest of the file is untouched. */
export function withOutcome(
  text: string,
  result: string,
  section: string,
): string {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) {
    throw new IdeaError(
      "The idea has no frontmatter to record the outcome in.",
    );
  }
  lines.splice(end, 0, `outcome: ${result}`);
  return `${lines.join("\n").trimEnd()}\n\n${section.trim()}\n`;
}
