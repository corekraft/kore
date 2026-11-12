import { IdeaError, type IdeaRecord, type NewIdea } from "../idea/index.js";

export const OUTCOME_KINDS = ["experiment", "usage", "verification"] as const;
export const OUTCOME_SOURCES = [
  "live-run",
  "journal",
  "eval-history",
  "comparison",
] as const;
export const RESULTS = ["confirmed", "refuted", "inconclusive"] as const;
export type Result = (typeof RESULTS)[number];

export interface Outcome {
  kind: (typeof OUTCOME_KINDS)[number];
  source: (typeof OUTCOME_SOURCES)[number];
  result: Result;
  evidence: string;
  summary: string;
  /** Set when the outcome proves a flag live in an environment (ADR 0077). */
  flag?: { name: string; environment: string };
}

export const labelFor = (result: Result) => `outcome:${result}`;

/** The marker that tells a rerun an idea's outcome comment is already on its issue. */
export const markerFor = (record: IdeaRecord) =>
  `<!-- harness outcome idea ${record.number} -->`;

function choice<T extends string>(
  flag: string,
  allowed: readonly T[],
  value: string | undefined,
): T {
  if (value === undefined || value.trim() === "") {
    throw new IdeaError(
      `Missing --${flag}; pass one of ${allowed.join(", ")}.`,
    );
  }
  const found = allowed.find((a) => a === value.trim());
  if (found === undefined) {
    throw new IdeaError(
      `--${flag} "${value}" is not recognised; use one of ${allowed.join(", ")}.`,
    );
  }
  return found;
}

function text(flag: string, value: string | undefined, hint: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") {
    throw new IdeaError(`Missing --${flag}; ${hint}.`);
  }
  return trimmed;
}

/** Validates the outcome flags, so every failure precedes any write. */
export function parseOutcome(options: {
  kind?: string | undefined;
  source?: string | undefined;
  result?: string | undefined;
  evidence?: string | undefined;
  summary?: string | undefined;
  flag?: string | undefined;
  environment?: string | undefined;
}): Outcome {
  const kind = choice("kind", OUTCOME_KINDS, options.kind);
  const source = choice("source", OUTCOME_SOURCES, options.source);
  const result = choice("result", RESULTS, options.result);
  const evidence = text(
    "evidence",
    options.evidence,
    "name the run, journal entry, eval record or comparison it was measured on",
  ).replace(/\s+/g, " ");
  const summary = text(
    "summary",
    options.summary,
    "state what was observed against the idea's expected outcome",
  );
  if (summary.includes("<!--") || options.evidence?.includes("<!--") === true) {
    throw new IdeaError(
      "--summary and --evidence must not contain an HTML comment; it could forge the marker that tells a rerun the outcome is posted, so reword it.",
    );
  }
  if (/^- [A-Za-z]+:/m.test(summary)) {
    throw new IdeaError(
      '--summary must not start a line with "- Name:"; it could override a recorded field such as Flag or Result, so reword it.',
    );
  }
  if (/^#/m.test(summary)) {
    throw new IdeaError(
      "--summary must not start a line with #; it would open a new section in the idea, so reword it.",
    );
  }
  const flag = parseFlag(kind, source, options.flag, options.environment);
  return { kind, source, result, evidence, summary, ...flag };
}

const FLAG_NAME = /^[a-z][a-z0-9-]*$/;

/** The flag an outcome proves: both --flag and --environment, and only on a live-run verification. */
function parseFlag(
  kind: Outcome["kind"],
  source: Outcome["source"],
  name: string | undefined,
  environment: string | undefined,
): Pick<Outcome, "flag"> {
  const given = [name, environment].map((v) => (v ?? "").trim());
  if (given.every((v) => v === "")) {
    return {};
  }
  for (const [flag, value] of [
    ["flag", given[0]],
    ["environment", given[1]],
  ] as const) {
    if (value === "") {
      const other = flag === "flag" ? "environment" : "flag";
      throw new IdeaError(
        `Missing --${flag}; a flag outcome names both --flag and --environment (got only --${other}).`,
      );
    }
    if (!FLAG_NAME.test(value ?? "")) {
      throw new IdeaError(
        `--${flag} "${value}" must be lowercase letters, digits and hyphens, starting with a letter.`,
      );
    }
  }
  if (kind !== "verification" || source !== "live-run") {
    throw new IdeaError(
      `--flag proves a flag only on --kind verification with --source live-run (got ${kind} from ${source}); a different outcome cannot activate it.`,
    );
  }
  return { flag: { name: given[0] ?? "", environment: given[1] ?? "" } };
}

/** The `## Outcome` section the idea file carries. */
export function renderSection(outcome: Outcome, date: string): string {
  return [
    "## Outcome",
    "",
    `- Result: ${outcome.result}`,
    `- Kind: ${outcome.kind}`,
    `- Source: ${outcome.source}`,
    ...(outcome.flag === undefined
      ? []
      : [
          `- Flag: ${outcome.flag.name}`,
          `- Environment: ${outcome.flag.environment}`,
        ]),
    `- Evidence: ${outcome.evidence}`,
    `- Recorded: ${date}`,
    "",
    outcome.summary,
  ].join("\n");
}

/** The idea that follows a refuted or inconclusive outcome: the same claim to revise, linked back, with no issue and so no approval. */
export function followUpOf(
  record: IdeaRecord,
  result: Result,
): { slug: string; idea: NewIdea } {
  return {
    // The number keeps the slug unique when long slugs share a prefix.
    slug: `follow-up-${record.number}-${record.slug}`
      .slice(0, 60)
      .replace(/-+$/, ""),
    idea: {
      title: `Follow up: ${record.title}`,
      summary: `Follow up on idea ${record.number} after a ${result} outcome`,
      hypothesis: `After a ${result} outcome on idea ${record.number}, revisit: ${record.hypothesis}`,
      expectedOutcome: record.expectedOutcome,
      measurement: record.measurement,
      safetyPattern: record.safetyPattern,
      parent: record.number,
    },
  };
}
