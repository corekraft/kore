// Docs: docs/decisions/0174-the-platform-turns-an-app-flag-on-from-evidence-it-collected-itself.md
import type { FileSystem } from "../runtime/index.js";
import { APP_OUTCOMES_DIR, parseWindow } from "./app-window-record.js";
import type { AppFlagWindows, WindowRecord } from "./app-windows.js";
import { FlagError } from "./overlay.js";

const FLAG = /^[a-z][a-z0-9.-]*$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]*$/;

/**
 * The platform's window store behind the ProofSources interface: each flag's
 * windows, read from the one directory the platform writes them to. A name
 * that could leave that directory has no windows.
 */
export function platformWindows(root: string, fs: FileSystem): AppFlagWindows {
  return {
    list: (flag, environment) => listWindows(root, fs, flag, environment),
  };
}

async function listWindows(
  root: string,
  fs: FileSystem,
  flag: string,
  environment: string,
): Promise<WindowRecord[]> {
  if (!FLAG.test(flag) || !ENVIRONMENT.test(environment)) {
    return [];
  }
  const dir = `${APP_OUTCOMES_DIR}/${environment}/${flag}`;
  const names = await fs.readdir(`${root}/${dir}`).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const found: WindowRecord[] = [];
  for (const name of names.filter((n) => n.endsWith(".json")).sort()) {
    const path = `${dir}/${name}`;
    const window = parseWindow(await fs.readFile(`${root}/${path}`), path);
    if (window.flag !== flag || window.environment !== environment) {
      throw new FlagError(
        `${path} records flag ${window.flag} in ${window.environment}, not ${flag} in ${environment}; a window stays under the flag and environment it was recorded for. Restore it from git, then rerun.`,
      );
    }
    found.push({
      path,
      flag,
      environment,
      kind: window.kind,
      result: window.result,
    });
  }
  return found;
}
