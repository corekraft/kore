import { environments, readOverlay } from "../flag/index.js";
import type { CliDeps } from "../runtime/index.js";

/** The flag that moves session spawn and its tools onto hc; off in every overlay until the owner activates it (plan 16, Grilled Decisions 7). */
export const HC_SESSIONS_FLAG = "hc-sessions";

const ENVIRONMENT = "local";

/** The backend a brief is written for: hc when the flag is on, herdr otherwise. */
export async function briefBackend(
  deps: Pick<CliDeps, "fs" | "root">,
): Promise<"herdr" | "hc"> {
  return (await hcSessionsOn(deps)) ? "hc" : "herdr";
}

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
