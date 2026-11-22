import { FlagError } from "../flag/index.js";
import type { CommandContext } from "../runtime/index.js";
import { hcSessionsOn } from "./hc-flag.js";
import { fail, FAILED } from "./output.js";
import { spawn } from "./spawn.js";
import { spawnHc } from "./spawn-hc.js";

/**
 * `session spawn`: the hc path when the hc-sessions flag is on, else the herdr path, unchanged. A local overlay that
 * cannot be read stops the spawn with the overlay's own message, before either path runs; a missing overlay is off.
 */
export async function spawnRouted(context: CommandContext): Promise<number> {
  const { json, deps } = context;
  let on: boolean;
  try {
    on = await hcSessionsOn(deps);
  } catch (error) {
    if (error instanceof FlagError) {
      return fail(deps, json, FAILED, error.message);
    }
    throw error;
  }
  return on ? spawnHc(context) : spawn(context);
}
