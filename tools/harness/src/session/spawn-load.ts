import type { CliDeps } from "../runtime/index.js";

/** The environment variable that sets the host load ceiling for a new writer. Unset means no ceiling. */
export const SPAWN_MAX_LOAD = "KORE_SPAWN_MAX_LOAD";

/**
 * Why a new writer must not start under the load ceiling, or undefined when it
 * may. Unset (or empty) means no ceiling and the load is not read. A ceiling
 * whose load cannot be read is refused rather than treated as clear.
 */
export function spawnLoadRefusal(
  deps: Pick<CliDeps, "env"> & Partial<Pick<CliDeps, "hostLoad">>,
): string | undefined {
  const setting = deps.env[SPAWN_MAX_LOAD];
  if (setting === undefined || setting === "") {
    return undefined;
  }
  if (!/^\d+(\.\d+)?$/.test(setting)) {
    return `${SPAWN_MAX_LOAD} must be a number such as 20, or unset; got "${setting}". No session was started.`;
  }
  if (deps.hostLoad === undefined) {
    return `The host load average cannot be read, so ${SPAWN_MAX_LOAD}=${setting} cannot be checked. Unset ${SPAWN_MAX_LOAD} to spawn without the check. No session was started.`;
  }
  const load = deps.hostLoad.oneMinute();
  if (load <= Number(setting)) {
    return undefined;
  }
  return `The host 1-minute load average is ${load.toFixed(2)}, above ${SPAWN_MAX_LOAD}=${setting}, so a new writer would add load to a busy host. Wait for the load to fall and spawn again, or raise ${SPAWN_MAX_LOAD} (or unset it) to override. No session was started.`;
}
