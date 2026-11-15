import type { CostMetric } from "../flow/index.js";
import {
  TIER_COST_METRIC,
  TIER_FIELDS,
  TIER_GUARD_METRIC,
  type IdeaRecord,
} from "../idea/index.js";

/**
 * Why a model-tier change may not approve itself, or undefined when it is a
 * frontmatter edit of model or effort measured on cost and judge send-backs
 * together. Anything else is not one revertible edit and is left for a person.
 */
export function tierRefusal(
  harness: NonNullable<IdeaRecord["harness"]>,
  input: {
    known: readonly string[];
    trailing: Readonly<Record<string, CostMetric>>;
  },
): string | undefined {
  const { tier } = harness;
  if (tier === undefined) {
    return undefined;
  }
  const stray = tier.fields.filter((field) => !TIER_FIELDS.includes(field));
  if (stray.length > 0) {
    return `it declares a tier change touching ${stray.join(", ")}; only model or effort in an agent definition's frontmatter is a reversible tier change.`;
  }
  if (tier.guardMetric !== TIER_GUARD_METRIC) {
    return `a tier change is measured on cost and judge send-backs together, and this one declares no guard metric (${TIER_GUARD_METRIC}).`;
  }
  if (harness.metric !== TIER_COST_METRIC || harness.direction !== "down") {
    return `a tier change's cost metric is ${TIER_COST_METRIC} expected to fall, not ${harness.metric} ${harness.direction}.`;
  }
  if (!input.known.includes(TIER_GUARD_METRIC)) {
    return `${TIER_GUARD_METRIC} is not a metric of the flow report (see \`harness flow report --json\`), so send-backs cannot be compared.`;
  }
  const found = input.trailing[TIER_GUARD_METRIC];
  if (found === undefined) {
    return `${TIER_GUARD_METRIC} is in the flow report but has no trailing average to compare send-backs against.`;
  }
  if (found.status !== "ok") {
    return `${TIER_GUARD_METRIC} has too little history to compare send-backs against (${found.closedIdeas} closed ideas, ${found.needed} needed).`;
  }
  return undefined;
}
