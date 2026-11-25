import { DEFAULT_COST, type CostOptions, type Threshold } from "./cost.js";
import { loginsOf } from "./cost-config-logins.js";
import { minCategorisedSendBacksOf } from "./cost-config-send-backs.js";
import {
  bad,
  isObject,
  type Failure,
  type Raw,
} from "./cost-config-support.js";

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
  /** The compaction cap in tokens, which the stop hook measures requests against; absent when not set. */
  compactionCap?: number;
  /** The weekly token ceiling in plan-weighted tokens; absent when not set, which a report reads as "not set", never zero. */
  weeklyTokenCeiling?: number;
  /** The soak, in whole days, a feature flag needs on before `harness flag retire` removes it (ADR 0149); absent when not set, so no flag retires on a guessed soak. */
  retireSoakDays?: number;
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
  const minCategorised = minCategorisedSendBacksOf(
    file,
    cost["minCategorisedSendBacks"],
  );
  if (typeof minCategorised !== "number") {
    return minCategorised;
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
      minCategorisedSendBacks: minCategorised,
      tokensPerIdea: tokens,
      sessionsPerIdea: sessions,
    },
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

/** A whole number of at least 1 under a key the config may leave out; a key left out is not in the result, and a bad value gives the key's fix. */
function wholeKeyOf<K extends string>(
  file: string,
  key: K,
  value: unknown,
  fix: string,
): { [P in K]?: number } | Failure {
  if (value === undefined) {
    return {};
  }
  if (!wholeAtLeastOne(value)) {
    return bad(file, key, fix);
  }
  const set: Partial<Record<K, number>> = {};
  set[key] = value;
  return set;
}

/** The retirement soak in whole days, at least 0 (ADR 0149), or nothing when it is left out. */
function soakOf(
  file: string,
  value: unknown,
): { retireSoakDays?: number } | Failure {
  if (value === undefined) {
    return {};
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { retireSoakDays: value };
  }
  return bad(
    file,
    "retireSoakDays",
    "must be a whole number of days, at least 0 (ADR 0149). Fix the value.",
  );
}

/** The owner login, reviewer logins, retro minimums, compaction cap, weekly token ceiling and retirement soak, each checked; the first bad one is the error. */
function settingsOf(
  file: string,
  value: Raw,
):
  | {
      ownerLogin?: string;
      reviewerLogins?: string[];
      retro?: RetroHistoryConfig;
      compactionCap?: number;
      weeklyTokenCeiling?: number;
      retireSoakDays?: number;
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
  const cap = wholeKeyOf(
    file,
    "compactionCap",
    value["compactionCap"],
    "must be a whole number of at least 1. Fix the value.",
  );
  if ("error" in cap) {
    return cap;
  }
  const ceiling = wholeKeyOf(
    file,
    "weeklyTokenCeiling",
    value["weeklyTokenCeiling"],
    'must be a whole number of plan-weighted tokens of at least 1, or left out to read "not set". Fix the value.',
  );
  if ("error" in ceiling) {
    return ceiling;
  }
  const soak = soakOf(file, value["retireSoakDays"]);
  if ("error" in soak) {
    return soak;
  }
  return { ...owner, ...retro, ...cap, ...ceiling, ...soak };
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
    "compactionCap",
    "weeklyTokenCeiling",
    "retireSoakDays",
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
    "minCategorisedSendBacks",
    "tokensPerIdea",
    "sessionsPerIdea",
  ]);
  if (inner !== undefined) {
    return inner;
  }
  const parsed = parseCost(file, cost);
  return "error" in parsed ? parsed : { ...parsed, ...owner };
}
