import { environments, readOverlay } from "../flag/index.js";
import type { CliDeps } from "../runtime/index.js";

/** The flag that moves session spawn and its tools onto hc; off in every overlay until the owner activates it (plan 16, Grilled Decisions 7). */
export const HC_SESSIONS_FLAG = "hc-sessions";

const ENVIRONMENT = "local";

/** Whether the local overlay turns hc-sessions on. No local environment means off. */
export async function hcSessionsOn(
  deps: Pick<CliDeps, "fs" | "root">,
): Promise<boolean> {
  const root = await deps.root();
  if (!(await environments(deps.fs, root)).includes(ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(deps.fs, root, ENVIRONMENT);
  return overlay.features[HC_SESSIONS_FLAG] === true;
}
