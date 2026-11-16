import { DEFAULT_COST, type CostOptions, type Threshold } from "./cost.js";

/** The harness config, relative to the repository root. */
export const HARNESS_CONFIG = ".claude/harness.json";

/**
 * The history the retro scan needs before it proposes removals: enough days of
 * ledger or enough sessions, whichever comes first. Placeholders set by ADR 0117,
 * to be re-checked against about two weeks of ledger.
 */
export const DEFAULT_RETRO_HISTORY = { minDays: 14, minSessions: 100 };

export interface RetroHistoryConfig {
  minDays?: number;
  minSessions?: number;
}

export interface HarnessConfig {
  cost: CostOptions;
  /** The GitHub login whose actions count as owner time; the repository's owner when absent. */
  ownerLogin?: string;
  /** The GitHub logins whose principles-review verdicts the judge trusts; the owner login when absent. */
  reviewerLogins?: string[];
  /** The retro scan's history minimums; a minimum the config leaves out keeps its default. */
  retro?: RetroHistoryConfig;
}

type Failure = { error: string };
type Raw = Record<string, unknown>;

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function bad(file: string, key: string, fix: string): Failure {
  return { error: `Invalid ${file}: key "${key}" ${fix}` };
}

function unknownKey(file: string, path: string, raw: Raw, known: string[]) {
  const extra = Object.keys(raw).find((k) => !known.includes(k));
  return extra === undefined
    ? undefined
    : bad(
        file,
        path === "" ? extra : `${path}.${extra}`,
        `is not a harness config key. Remove it, or use one of: ${known.join(", ")}.`,
      );
}

function threshold(
  file: string,
  path: string,
  value: unknown,
  fallback: Threshold,
): Threshold | Failure {
  if (value === undefined) {
    return fallback;
  }
  if (!isObject(value)) {
    return bad(file, path, 'must be an object. Use {"maxIncrease": 0.25}.');
  }
  const extra = unknownKey(file, path, value, ["maxIncrease"]);
  if (extra !== undefined) {
    return extra;
  }
  const max = value["maxIncrease"];
  if (max === undefined) {
    return fallback;
  }
  if (typeof max !== "number" || !Number.isFinite(max) || max < 0) {
    return bad(
      file,
      `${path}.maxIncrease`,
      `must be a number of at least 0 (0.25 means worsened above 125% of the trailing average). Fix the value.`,
    );
  }
  return { maxIncrease: max };
}

const wholeAtLeastOne = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

function parseCost(file: string, cost: Raw): HarnessConfig | Failure {
  const trailing = cost["trailingIdeas"] ?? DEFAULT_COST.trailingIdeas;
  if (!wholeAtLeastOne(trailing)) {
    return bad(
      file,
      "cost.trailingIdeas",
      "must be a whole number of at least 1. Fix the value.",
    );
  }
  const minMerged = cost["minMergedChanges"] ?? DEFAULT_COST.minMergedChanges;
  if (!wholeAtLeastOne(minMerged)) {
    return bad(
      file,
      "cost.minMergedChanges",
      "must be a whole number of at least 1. Fix the value.",
    );
  }
  const tokens = threshold(
    file,
    "cost.tokensPerIdea",
    cost["tokensPerIdea"],
    DEFAULT_COST.tokensPerIdea,
  );
  if ("error" in tokens) {
    return tokens;
  }
  const sessions = threshold(
    file,
    "cost.sessionsPerIdea",
    cost["sessionsPerIdea"],
    DEFAULT_COST.sessionsPerIdea,
  );
  if ("error" in sessions) {
    return sessions;
  }
  return {
    cost: {
      trailingIdeas: trailing,
      minMergedChanges: minMerged,
      tokensPerIdea: tokens,
      sessionsPerIdea: sessions,
    },
  };
}

const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
/** A GitHub App's login as gh reports it on the App's comments and PRs: `app/<slug>`. */
const APP_LOGIN = /^app\/[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

function reviewerLoginsOf(
  file: string,
  value: unknown,
): { reviewerLogins?: string[] } | Failure {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (r) => typeof r === "string" && (LOGIN.test(r) || APP_LOGIN.test(r)),
    )
  ) {
    return bad(
      file,
      "reviewerLogins",
      'must be a non-empty list of GitHub logins of letters, digits and "-", or of a GitHub App as app/<slug>. Use ["junners"] or ["junners", "app/kore-reviewer"], or remove the key to trust the owner login.',
    );
  }
  return { reviewerLogins: value as string[] };
}

/** The owner login and the reviewer logins, each checked; a bad one names its key and the fix. */
function loginsOf(
  file: string,
  value: Raw,
): { ownerLogin?: string; reviewerLogins?: string[] } | Failure {
  const login = value["ownerLogin"];
  if (
    login !== undefined &&
    (typeof login !== "string" || !LOGIN.test(login))
  ) {
    return bad(
      file,
      "ownerLogin",
      'must be a GitHub login of letters, digits and "-". Use "junners".',
    );
  }
  const reviewers = reviewerLoginsOf(file, value["reviewerLogins"]);
  if ("error" in reviewers) {
    return reviewers;
  }
  return {
    ...(login === undefined ? {} : { ownerLogin: login as string }),
    ...reviewers,
  };
}

/** The retro minimums that are set; a key the config leaves out is not in the result. */
function retroOf(
  file: string,
  value: unknown,
): { retro?: RetroHistoryConfig } | Failure {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value)) {
    return bad(
      file,
      "retro",
      'must be an object. Use {"minDays": 14, "minSessions": 100}.',
    );
  }
  const extra = unknownKey(file, "retro", value, ["minDays", "minSessions"]);
  if (extra !== undefined) {
    return extra;
  }
  const retro: RetroHistoryConfig = {};
  for (const key of ["minDays", "minSessions"] as const) {
    const minimum = value[key];
    if (minimum === undefined) {
      continue;
    }
    if (
      typeof minimum !== "number" ||
      !Number.isSafeInteger(minimum) ||
      minimum < 1
    ) {
      return bad(
        file,
        `retro.${key}`,
        "must be a whole number of at least 1. Fix the value.",
      );
    }
    retro[key] = minimum;
  }
  return { retro };
}

/** The owner login, reviewer logins and retro minimums, each checked; the first bad one is the error. */
function settingsOf(
  file: string,
  value: Raw,
):
  | {
      ownerLogin?: string;
      reviewerLogins?: string[];
      retro?: RetroHistoryConfig;
    }
  | Failure {
  const owner = loginsOf(file, value);
  if ("error" in owner) {
    return owner;
  }
  const retro = retroOf(file, value["retro"]);
  if ("error" in retro) {
    return retro;
  }
  return { ...owner, ...retro };
}

/** Checks the harness config text before any report uses it; a bad key names the file, the key and the fix. */
export function parseHarnessConfig(
  text: string,
  file: string,
): HarnessConfig | Failure {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: `Invalid ${file}: it is not valid JSON. Fix the syntax.` };
  }
  if (!isObject(value)) {
    return bad(file, "(root)", "must be a JSON object. Use {}.");
  }
  const top = unknownKey(file, "", value, [
    "cost",
    "ownerLogin",
    "reviewerLogins",
    "retro",
  ]);
  if (top !== undefined) {
    return top;
  }
  const owner = settingsOf(file, value);
  if ("error" in owner) {
    return owner;
  }
  const cost = value["cost"];
  if (cost === undefined) {
    return { cost: DEFAULT_COST, ...owner };
  }
  if (!isObject(cost)) {
    return bad(file, "cost", "must be an object. Use {}.");
  }
  const inner = unknownKey(file, "cost", cost, [
    "trailingIdeas",
    "minMergedChanges",
    "tokensPerIdea",
    "sessionsPerIdea",
  ]);
  if (inner !== undefined) {
    return inner;
  }
  const parsed = parseCost(file, cost);
  return "error" in parsed ? parsed : { ...parsed, ...owner };
}
