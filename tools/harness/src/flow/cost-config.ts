import { DEFAULT_COST, type CostOptions, type Threshold } from "./cost.js";

/** The harness config, relative to the repository root. */
export const HARNESS_CONFIG = ".claude/harness.json";

export interface HarnessConfig {
  cost: CostOptions;
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

function parseCost(file: string, cost: Raw): HarnessConfig | Failure {
  const trailing = cost["trailingIdeas"] ?? DEFAULT_COST.trailingIdeas;
  if (
    typeof trailing !== "number" ||
    !Number.isSafeInteger(trailing) ||
    trailing < 1
  ) {
    return bad(
      file,
      "cost.trailingIdeas",
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
      tokensPerIdea: tokens,
      sessionsPerIdea: sessions,
    },
  };
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
  const top = unknownKey(file, "", value, ["cost"]);
  if (top !== undefined) {
    return top;
  }
  const cost = value["cost"];
  if (cost === undefined) {
    return { cost: DEFAULT_COST };
  }
  if (!isObject(cost)) {
    return bad(file, "cost", "must be an object. Use {}.");
  }
  const inner = unknownKey(file, "cost", cost, [
    "trailingIdeas",
    "tokensPerIdea",
    "sessionsPerIdea",
  ]);
  if (inner !== undefined) {
    return inner;
  }
  return parseCost(file, cost);
}
