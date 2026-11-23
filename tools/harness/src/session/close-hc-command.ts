import type { CommandContext } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { closeOnHc } from "./close-hc.js";
import { removeMergedWorktree, type Removal } from "./close-worktree.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

/** Removes the session's worktree and branch when --remove-worktree asked; a session without one has nothing to remove. */
async function removeWorktree(
  { deps }: CommandContext,
  record: SessionRecord,
): Promise<Removal> {
  return record.worktree === undefined
    ? {
        removed: false,
        reason: `Session ${record.name} has no worktree, so there is none to remove.`,
      }
    : await removeMergedWorktree(
        deps.runner,
        record.worktree,
        deps.cwd,
        `session close ${record.name} --remove-worktree`,
      );
}

/**
 * `session close` on hc, as the command runs it: prints the close, or the reason it was refused, and returns the exit
 * code. With --remove-worktree it then removes the session's worktree and branch once a merged pull request has the
 * branch at the worktree's HEAD; a kept worktree is explained and exits 1, the terminal staying closed. On a session
 * already closed the flag retries only that removal.
 */
export async function closeHcSession(
  context: CommandContext,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
): Promise<number> {
  const { json, deps, options } = context;
  const { name } = record;
  const asked = options["remove-worktree"] === true;
  const retry = asked && record.closedAt !== undefined;
  if (!retry) {
    const closed = await closeOnHc(deps, terminals, registry, record);
    if ("error" in closed) {
      return fail(deps, json, FAILED, closed.error);
    }
  }
  const removal = asked ? await removeWorktree(context, record) : undefined;
  const kept = removal !== undefined && !removal.removed;
  if (kept) {
    deps.stderr(`${removal.reason}\n`);
  }
  const where =
    record.terminal === undefined
      ? "it never started a terminal"
      : `terminal ${record.terminal}`;
  const lead = retry
    ? `Session ${name} was already closed (${where}).`
    : `Closed ${name} (${where}).`;
  const detail = removal?.removed === true ? ` ${removal.message}` : "";
  deps.stdout(
    json
      ? `${JSON.stringify({ name, terminal: record.terminal, closed: true, ...(retry ? { alreadyClosed: true } : {}), ...(removal === undefined ? {} : { removal }) })}\n`
      : `${lead}${detail}\n`,
  );
  return kept ? FAILED : 0;
}
