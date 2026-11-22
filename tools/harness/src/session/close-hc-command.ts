import type { CommandContext } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { closeOnHc } from "./close-hc.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

/**
 * `session close` on hc, as the command runs it: prints the close, or the reason it was refused, and returns the exit
 * code. --remove-worktree is refused here, before anything is killed: a worktree on hc is removed with git (not ported).
 */
export async function closeHcSession(
  context: CommandContext,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
): Promise<number> {
  const { json, deps, options } = context;
  const { name } = record;
  if (options["remove-worktree"] === true) {
    return fail(
      deps,
      json,
      FAILED,
      `session close ${name} --remove-worktree is not on hc yet, so nothing was closed. Close it without the flag, then remove its worktree with git once its pull request is merged.`,
    );
  }
  const closed = await closeOnHc(deps, terminals, registry, record);
  if ("error" in closed) {
    return fail(deps, json, FAILED, closed.error);
  }
  deps.stdout(
    json
      ? `${JSON.stringify({ name, terminal: record.terminal, closed: true })}\n`
      : `Closed ${name} (${record.terminal === undefined ? "it never started a terminal" : `terminal ${record.terminal}`}).\n`,
  );
  return 0;
}
