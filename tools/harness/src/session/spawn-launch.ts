import type { CommandContext } from "../runtime/index.js";
import { resolveTier, undefinedRoleError } from "./agent-definition.js";
import { writerExperiment } from "./spawn-experiment.js";
import { tierOf, type TierOrigin } from "./tier-source.js";

/** The model, effort and origin a launch runs on. */
export type Launch = { model: string; effort: string; origin: TierOrigin };

/** The role's model and effort, or the refusal: an undefined role first, then a missing setting. A flag wins over the definition, which is how a writer escalates. */
async function launchTier(
  deps: CommandContext["deps"],
  role: string,
  options: CommandContext["options"],
): Promise<{ model: string; effort: string } | { error: string }> {
  const undefinedRole = await undefinedRoleError(deps, role);
  if (undefinedRole !== undefined) {
    return { error: undefinedRole };
  }
  const flag = (name: "model" | "effort") =>
    typeof options[name] === "string" ? options[name] : undefined;
  return resolveTier(deps, role, {
    model: flag("model"),
    effort: flag("effort"),
  });
}

/**
 * The model, effort and origin a launch runs on, or the refusal. A default-tier
 * writer the experiment window samples runs on Sonnet, recorded as an override
 * with its reason; a misconfigured window refuses a writer; every other launch
 * keeps the definition or the flags.
 */
export async function launchOf(
  deps: CommandContext["deps"],
  role: string,
  options: CommandContext["options"],
): Promise<Launch | { error: string }> {
  const resolved = await launchTier(deps, role, options);
  if ("error" in resolved) {
    return resolved;
  }
  const origin = await tierOf(deps, options);
  const sampled = writerExperiment({
    role,
    origin,
    env: deps.env,
    now: deps.clock.now(),
    random: deps.random,
  });
  if (sampled !== undefined && "error" in sampled) {
    return sampled;
  }
  return sampled === undefined
    ? { ...resolved, origin }
    : { ...resolved, model: sampled.model, origin: sampled.tier };
}
