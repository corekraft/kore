// What the retro scan reads from the ledger: the events, and the role each session
// name was launched as. Read-only, and never a transcript.
// Docs: infra/plans/12-self-improving-loop.md (Step 2)

import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger, type LedgerEvent } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

/** Every event in the main checkout's ledger, or undefined when there is no main checkout. */
export async function ledgerEvents(
  deps: CliDeps,
): Promise<LedgerEvent[] | undefined> {
  const main = await mainRoot(deps);
  if (main === undefined) {
    return undefined;
  }
  const ledger = new Ledger(
    deps.fs,
    deps.clock,
    deps.ids,
    join(main, DEFAULT_LEDGER),
  );
  return (await ledger.list({})).events;
}

/**
 * The role each session name was launched as, from the ledger's launches. A name
 * launched twice keeps the role of its later launch. The names and roles are all
 * the report learns from the ledger for a bare send.
 */
export async function sessionRoles(
  deps: CliDeps,
): Promise<Record<string, string>> {
  const events = (await ledgerEvents(deps)) ?? [];
  const roles: Record<string, string> = {};
  const ordered = [...events].sort(
    (a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt),
  );
  for (const { kind, agent, role } of ordered) {
    if (
      kind === "session.launch" &&
      agent !== undefined &&
      role !== undefined
    ) {
      roles[agent] = role;
    }
  }
  return roles;
}
