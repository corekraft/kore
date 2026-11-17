// The session commands' reader of the signed-main-sends flag (ADR 0123): the local
// overlay of the main checkout decides it. No checkout, no overlay or an unwritten
// flag means off, so delivery keeps today's confirmation.

import { environments, readOverlay } from "../flag/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

export const SIGNED_MAIN_SENDS_FLAG = "signed-main-sends";
const FLAG_ENVIRONMENT = "local";

/** Whether the main checkout's local overlay turns signed-main-sends on. A malformed overlay throws its FlagError. */
export async function signedMainSendsOn(deps: CliDeps): Promise<boolean> {
  const root = await mainRoot(deps);
  if (root === undefined) {
    return false;
  }
  if (!(await environments(deps.fs, root)).includes(FLAG_ENVIRONMENT)) {
    return false;
  }
  const overlay = await readOverlay(deps.fs, root, FLAG_ENVIRONMENT);
  return overlay.features[SIGNED_MAIN_SENDS_FLAG] === true;
}
