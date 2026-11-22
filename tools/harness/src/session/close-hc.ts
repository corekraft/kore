import type { CliDeps, CommandContext } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import { recordTerminalEvent } from "./hc-ledger.js";
import { FAILED, fail } from "./output.js";
import type { SessionRecord, SessionRegistry } from "./registry.js";

/** What a closed hc session settles on: when it was closed. */
export interface ClosedOnHc {
  closedAt: string;
}

/**
 * `session close <name>` on hc: kills the session's terminal if it is live, writes its pane.closed ledger
 * event, then removes the terminal and marks the record closed. Only the terminal that spawned the session may
 * close it (its parent is the caller), and a terminal whose event cannot be written is not removed, so a rerun
 * finishes the close (plan 16, Step 4 (d)).
 */
export async function closeOnHc(
  deps: CliDeps,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "write">,
  record: SessionRecord,
): Promise<ClosedOnHc | { error: string }> {
  const { name } = record;
  if (record.closedAt !== undefined) {
    return {
      error: `Session ${name} is already closed (terminal ${record.terminal}).`,
    };
  }
  const self = terminals.self();
  if (self === undefined) {
    return {
      error: `Not inside an hc terminal (HC_TERMINAL_ID is unset), so session close ${name} was not run. Run it from the terminal that spawned the session.`,
    };
  }
  const target = await terminals.get(record.terminal ?? "");
  if ("error" in target) {
    return { error: `Session ${name}: ${hcMessage(target)}` };
  }
  if (target.parent !== self) {
    return {
      error: `Session ${name} runs on terminal ${target.id}, whose parent is ${target.parent ?? "none"}, not ${self}; only the terminal that spawned it may close it, so nothing was closed.`,
    };
  }
  if (target.state === "live") {
    const killed = await terminals.kill(target.id);
    if ("error" in killed) {
      return {
        error: `Session ${name} was not killed: ${hcMessage(killed)}. Nothing was removed.`,
      };
    }
  }
  const unrecorded = await recordTerminalEvent(deps, {
    kind: "pane.closed",
    pane: target.id,
    agent: name,
  });
  if (unrecorded !== undefined) {
    return {
      error: `Session ${name} was killed, but its ledger event was not recorded (${unrecorded}), so terminal ${target.id} was not removed. Run session close ${name} again.`,
    };
  }
  const removed = await terminals.remove(target.id);
  if ("error" in removed) {
    return {
      error: `Session ${name} was killed and recorded, but terminal ${target.id} was not removed: ${hcMessage(removed)}.`,
    };
  }
  const closedAt = deps.clock.now().toISOString();
  await registry.write({ ...record, closedAt });
  return { closedAt };
}

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
      : `Closed ${name} (terminal ${record.terminal}).\n`,
  );
  return 0;
}
