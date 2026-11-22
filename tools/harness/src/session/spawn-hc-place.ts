import type { CliDeps } from "../runtime/index.js";
import { mainRoot } from "../runtime/index.js";
import { SessionRegistry } from "./registry.js";
import { place, type Worktree } from "./worktree.js";

/** What a session reserves before it starts: the registry that holds its record, the directory it runs in, and the main checkout. */
export interface Reserved {
  registry: SessionRegistry;
  cwd: string;
  main: string;
  worktree?: Worktree;
}

/**
 * Reserves a session's name and place: refused while a record for the name is open, else the worktree (or the caller's
 * directory) and the main checkout. Nothing is started here, so a refusal leaves no terminal behind.
 */
export async function reserve(
  deps: CliDeps,
  options: Record<string, string | boolean>,
  name: string,
): Promise<Reserved | { error: string }> {
  const registry = await SessionRegistry.open(deps);
  const taken = await registry.unavailable(name);
  if (taken !== undefined) {
    return {
      error: taken.replace(" No pane was split.", " No terminal was started."),
    };
  }
  const placed = await place(deps, options, name);
  if ("error" in placed) {
    return placed;
  }
  const main = await mainRoot(deps);
  if (main === undefined) {
    return {
      error:
        "Cannot find the main checkout to keep session state in. Run inside the repository or set KORE_ROOT to its root.",
    };
  }
  return {
    registry,
    cwd: placed.cwd,
    main,
    ...(placed.worktree === undefined ? {} : { worktree: placed.worktree }),
  };
}
