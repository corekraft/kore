import type { CliDeps } from "../runtime/index.js";
import {
  AttendedTerminal,
  TickReconcile,
  unsettledOf,
} from "../orchestrator/index.js";
import {
  SessionRegistry,
  readReport,
  reportPath,
  terminalsFor,
} from "../session/index.js";

/** The notice's destination when hc-sessions is on: the one attended agent terminal, over the hc port (plan 16, Step 4). */
export function hcAttended(deps: CliDeps): {
  attendedPane: () => Promise<string | undefined>;
  send: (pane: string, body: string) => Promise<string | undefined>;
} {
  const attended = new AttendedTerminal(terminalsFor(deps));
  return {
    attendedPane: () => attended.attendedPane(),
    send: (pane, body) => attended.send(pane, body),
  };
}

/**
 * The reconcile over this checkout's session records, hc's listing and the reports under each
 * terminal's checkout (plan 16, Step 4). A block is written into the stored record, every other field kept.
 */
export async function hcReconcile(
  deps: CliDeps,
  main: string,
): Promise<TickReconcile> {
  const registry = await SessionRegistry.open(deps);
  const terminals = terminalsFor(deps);
  return new TickReconcile(
    {
      unsettled: async () => unsettledOf((await registry.all()).records),
      list: () => terminals.list(),
      reported: async (session, cwd) => {
        const report = await readReport(deps.fs, reportPath(cwd, session.name));
        return report !== undefined && report.seq > session.reportSeq;
      },
      block: async (name, summary) => {
        const record = await registry.read(name);
        // Re-read, so a session that settled since the listing is left as it is.
        if (
          record === undefined ||
          record.result !== undefined ||
          record.closedAt !== undefined ||
          (record.reportSeq ?? 0) > 0
        ) {
          return false;
        }
        await registry.write({
          ...record,
          result: {
            outcome: "blocked",
            at: deps.clock.now().toISOString(),
            summary,
          },
        });
        return true;
      },
    },
    main,
  );
}
