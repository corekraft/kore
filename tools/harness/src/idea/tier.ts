import { IdeaError } from "./error.js";

/** A model-tier idea's cost metric: the flow report's own name for tokens per idea. */
export const TIER_COST_METRIC = "metrics.tokensPerIdea";
/** The metric a tier change must not worsen: the flow report's own name for judge send-backs per idea. */
export const TIER_GUARD_METRIC = "rework.sendBacksPerIdea";
/** The only frontmatter keys of an agent definition a tier change may edit. */
export const TIER_FIELDS: readonly string[] = ["model", "effort"];

/** An edit to an agent definition's `model` or `effort`, with the metric that guards its cost saving. */
export interface Tier {
  fields: string[];
  /** Empty when the idea declared none; a check names it as missing. */
  guardMetric: string;
}

/** The tier block of a harness file as `{ tier }` to spread into its hypothesis; undefined when it declares no tier change. */
export function readTier(
  get: (key: string) => string,
): { tier: Tier } | undefined {
  const change = get("tier-change");
  if (change === "") {
    return undefined;
  }
  return {
    tier: {
      fields: change.split(",").map((field) => field.trim()),
      guardMetric: get("guard-metric"),
    },
  };
}

/** The frontmatter lines of a tier block; none without one. */
export function renderTier(tier: Tier | undefined): string[] {
  if (tier === undefined) {
    return [];
  }
  return [
    `tier-change: ${tier.fields.join(", ")}`,
    `guard-metric: ${tier.guardMetric}`,
  ];
}

/** The tier a new idea is created with; undefined without a tier flag, an IdeaError naming what is missing or wrong otherwise. */
export function tierFromFlags(flags: {
  tierChange?: string | undefined;
  guardMetric?: string | undefined;
}): Tier | undefined {
  const { tierChange, guardMetric } = flags;
  if (tierChange === undefined) {
    if (guardMetric !== undefined) {
      throw new IdeaError(
        "--guard-metric needs --tier-change; add it, or leave the guard flag out.",
      );
    }
    return undefined;
  }
  if (guardMetric === undefined) {
    throw new IdeaError(
      `A tier idea is missing --guard-metric; pass --guard-metric ${TIER_GUARD_METRIC}, because a tier change is measured on cost and judge send-backs together.`,
    );
  }
  const fields = tierChange.split(",").map((field) => field.trim());
  const stray = fields.find((field) => !TIER_FIELDS.includes(field));
  if (stray !== undefined) {
    throw new IdeaError(
      `--tier-change "${tierChange}" names ${stray}; a tier change edits only model or effort in an agent definition's frontmatter.`,
    );
  }
  if (guardMetric !== TIER_GUARD_METRIC) {
    throw new IdeaError(
      `--guard-metric "${guardMetric}" is not the judge send-backs metric; use ${TIER_GUARD_METRIC}.`,
    );
  }
  return { fields, guardMetric };
}

/** The hypothesis with its tier attached; a tier idea must expect tokens per idea to fall. */
export function attachTier<H extends { metric: string; direction: string }>(
  harness: H | undefined,
  tier: Tier | undefined,
): H | (H & { tier: Tier }) | undefined {
  if (tier === undefined) {
    return harness;
  }
  if (harness === undefined) {
    throw new IdeaError(
      "--tier-change needs --kind harness; add it with the cost hypothesis.",
    );
  }
  if (harness.metric !== TIER_COST_METRIC) {
    throw new IdeaError(
      `A tier idea's hypothesis metric is ${TIER_COST_METRIC} (tokens per idea), not ${harness.metric}; pass --metric ${TIER_COST_METRIC} --direction down.`,
    );
  }
  if (harness.direction !== "down") {
    throw new IdeaError(
      `A tier idea expects ${TIER_COST_METRIC} to fall; pass --direction down.`,
    );
  }
  return { ...harness, tier };
}
