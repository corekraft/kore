import { resolve } from "node:path";
import { mainRoot, type CliDeps } from "../runtime/index.js";
import { DEFAULT_LEDGER, Ledger } from "./ledger.js";

/**
 * The one ledger every worktree shares: <main checkout root>/.kore/state/ledger.jsonl.
 * The main root is the parent of git's common dir, so a subdirectory or a linked
 * worktree resolves to the same file. `given` (a --ledger flag) is cwd-relative
 * and wins. Undefined when no main root can be found.
 */
export async function openSharedLedger(
  deps: CliDeps,
  given?: string,
): Promise<Ledger | undefined> {
  let path: string | undefined;
  if (given === undefined) {
    const main = await mainRoot(deps);
    path = main === undefined ? undefined : resolve(main, DEFAULT_LEDGER);
  } else {
    path = resolve(deps.cwd, given);
  }
  return path === undefined
    ? undefined
    : new Ledger(deps.fs, deps.clock, deps.ids, path);
}
