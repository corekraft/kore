import type { CommandContext } from "../runtime/index.js";
import { resolveTier, undefinedRoleError } from "./agent-definition.js";
import { writerExperiment } from "./spawn-experiment.js";
import { tierOf, type TierOrigin } from "./tier-source.js";

/** The model, effort and origin a launch runs on. */
export type Launch = { model: string; effort: string; origin: TierOrigin };

/** The role's model and effort from the given flags, or the refusal: an undefined role first, then a missing setting. A flag wins over the definition, which is how a writer escalates. */
async function launchTier(
  deps: CommandContext["deps"],
  role: string,
  flags: { model: string | undefined; effort: string | undefined },
): Promise<{ model: string; effort: string } | { error: string }> {
  const undefinedRole = await undefinedRoleError(deps, role);
  if (undefinedRole !== undefined) {
    return { error: undefinedRole };
  }
  return resolveTier(deps, role, flags);
}

/**
 * The model, effort and origin a launch runs on, or the refusal. A writer that
 * names no model, inside the experiment window, runs at the window effort
 * whatever effort it named: the window draws a share of them onto Sonnet and
 * keeps the rest on their definition's model as the control. A misconfigured
 * window refuses a writer; every other launch keeps the definition or the flags.
 */
export async function launchOf(
  deps: CommandContext["deps"],
  role: string,
  options: CommandContext["options"],
): Promise<Launch | { error: string }> {
  const flag = (name: "model" | "effort") =>
    typeof options[name] === "string" ? options[name] : undefined;
  const origin = await tierOf(deps, options);
  const sampled = writerExperiment({
    role,
    model: flag("model"),
    origin,
    env: deps.env,
    now: deps.clock.now(),
    random: deps.random,
  });
  if (sampled !== undefined && "error" in sampled) {
    return sampled;
  }
  const resolved = await launchTier(
    deps,
    role,
    sampled === undefined
      ? { model: flag("model"), effort: flag("effort") }
      : { model: undefined, effort: sampled.effort },
  );
  if ("error" in resolved) {
    return resolved;
  }
  if (sampled === undefined) {
    return { ...resolved, origin };
  }
  return {
    model: sampled.model ?? resolved.model,
    effort: sampled.effort,
    origin: sampled.tier,
  };
}
