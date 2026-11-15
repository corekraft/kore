export const SAFETY_PATTERNS = [
  "no-behaviour-change",
  "feature-flagged",
  "dark-launched",
  "branch-by-abstraction",
  "expand-contract",
] as const;

/** What a harness idea expects of one flow report metric, and how long to watch it. */
export interface Hypothesis {
  /** A metric name from the flow report. */
  metric: string;
  direction: "up" | "down";
  /** A number of days, such as 14d. */
  window: string;
}

const DIRECTIONS = ["up", "down"] as const;
const WINDOW = /^[1-9]\d*d$/;

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
  /** Set only on a harness idea. */
  harness?: Hypothesis;
}

export class IdeaError extends Error {}

export const IDEA_FILE = /^(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

const HYPOTHESIS_KEYS = [
  "hypothesis-metric",
  "hypothesis-direction",
  "hypothesis-window",
] as const;

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
  const harness = readHarness(path, get);
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
  if (harness !== undefined) {
    record.harness = harness;
  }
  return record;
}

/** The hypothesis block of a `kind: harness` file; undefined for any other idea. */
function readHarness(
  path: string,
  get: (key: string) => string,
): Hypothesis | undefined {
  if (get("kind") !== "harness") {
    return undefined;
  }
  const missing = HYPOTHESIS_KEYS.filter((key) => get(key) === "");
  if (missing.length > 0) {
    throw new IdeaError(
      `${path} is a harness idea missing frontmatter ${missing.join(", ")}; add each as a key: value line.`,
    );
  }
  const direction = DIRECTIONS.find((d) => d === get("hypothesis-direction"));
  if (direction === undefined) {
    throw new IdeaError(
      `${path} has hypothesis-direction ${get("hypothesis-direction")}; use up or down.`,
    );
  }
  return {
    metric: get("hypothesis-metric"),
    direction,
    window: get("hypothesis-window"),
  };
}

/**
 * The hypothesis a harness idea is created with. Undefined for an ordinary idea;
 * an IdeaError naming what is missing or wrong otherwise. `metrics` are the flow report's.
 */
export function harnessHypothesis(
  flags: {
    kind?: string | undefined;
    metric?: string | undefined;
    direction?: string | undefined;
    window?: string | undefined;
  },
  metrics: readonly string[],
): Hypothesis | undefined {
  const { kind, metric, direction, window } = flags;
  if (kind === undefined) {
    const stray = (["metric", "direction", "window"] as const).find(
      (flag) => flags[flag] !== undefined,
    );
    if (stray !== undefined) {
      throw new IdeaError(
        `--${stray} needs --kind harness; add it, or leave the hypothesis flags out.`,
      );
    }
    return undefined;
  }
  if (kind !== "harness") {
    throw new IdeaError(
      `--kind "${kind}" is not recognised; use harness, or leave it out.`,
    );
  }
  const missing = (["metric", "direction", "window"] as const).filter(
    (flag) => flags[flag] === undefined,
  );
  if (missing.length > 0) {
    throw new IdeaError(
      `A harness idea is missing ${missing.map((f) => `--${f}`).join(", ")}; pass each, e.g. --metric friction.total --direction down --window 14d.`,
    );
  }
  if (metric === undefined || !metrics.includes(metric)) {
    throw new IdeaError(
      `--metric "${metric}" is not a flow report metric; use one of ${metrics.join(", ")} (see \`harness flow report --json\`).`,
    );
  }
  const way = DIRECTIONS.find((d) => d === direction);
  if (way === undefined) {
    throw new IdeaError(`--direction "${direction}" is not up or down.`);
  }
  if (window === undefined || !WINDOW.test(window)) {
    throw new IdeaError(
      `--window "${window}" is not a number of days such as 14d.`,
    );
  }
  return { metric, direction: way, window };
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
  /** Present makes it a harness idea. */
  harness?: Hypothesis;
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
  if (idea.harness !== undefined) {
    lines.push(
      "kind: harness",
      `hypothesis-metric: ${idea.harness.metric}`,
      `hypothesis-direction: ${idea.harness.direction}`,
      `hypothesis-window: ${idea.harness.window}`,
    );
  }
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
