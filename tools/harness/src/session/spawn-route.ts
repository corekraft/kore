import type { CommandContext } from "../runtime/index.js";
import { hcSessionsOn } from "./hc-flag.js";
import { spawn } from "./spawn.js";
import { spawnHc } from "./spawn-hc.js";

/** `session spawn`: the hc path when the hc-sessions flag is on, else the herdr path, unchanged. */
export async function spawnRouted(context: CommandContext): Promise<number> {
  return (await hcSessionsOn(context.deps)) ? spawnHc(context) : spawn(context);
}
