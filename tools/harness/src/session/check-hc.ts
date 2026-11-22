import { join } from "node:path";
import type { CliDeps } from "../runtime/index.js";
import type { Terminal, Terminals } from "../terminal/index.js";
import { hcMessage } from "./backend.js";
import type { SessionRegistry } from "./registry.js";
import { reportDirOf } from "./report-file.js";

/** An agent terminal session spawn did not start: its role from the role label, or null when it has none. */
export interface UnmanagedTerminal {
  terminal: string;
  role: string | null;
}

/** A report file whose session has no open record: the file, and the session name it is named for. */
export interface OrphanReport {
  file: string;
  name: string;
}

export interface HcCheck {
  unmanaged: UnmanagedTerminal[];
  orphanReports: OrphanReport[];
}

/**
 * An agent terminal that session spawn did not start: live, reporting a status, under a parent, and with no
 * kore-session label. A top-level agent is not a spawn, so it is left out.
 */
function isUnmanaged(terminal: Terminal): boolean {
  return (
    terminal.state === "live" &&
    terminal.status !== undefined &&
    terminal.parent !== undefined &&
    terminal.labels["kore-session"] === undefined
  );
}

/** The report files in each checkout a terminal runs in, whose name has no open session record. */
async function orphansIn(
  deps: Pick<CliDeps, "fs">,
  dirs: readonly string[],
  open: ReadonlySet<string>,
): Promise<OrphanReport[]> {
  const orphans: OrphanReport[] = [];
  for (const dir of dirs) {
    const reportDir = reportDirOf(dir);
    if (!(await deps.fs.exists(reportDir))) {
      continue;
    }
    const files = (await deps.fs.readdir(reportDir))
      .filter((file) => file.endsWith(".json"))
      .sort();
    for (const file of files) {
      const name = file.slice(0, -".json".length);
      if (!open.has(name)) {
        orphans.push({ file: join(reportDir, file), name });
      }
    }
  }
  return orphans;
}

/**
 * `session check` on hc: lists the agent terminals session spawn did not start, and each report file with no
 * open session record, in the main checkout and in each terminal's checkout. Read-only.
 */
export async function checkOnHc(
  deps: Pick<CliDeps, "fs">,
  terminals: Terminals,
  registry: Pick<SessionRegistry, "all">,
  main: string,
): Promise<HcCheck | { error: string }> {
  const listed = await terminals.list();
  if ("error" in listed) {
    return { error: hcMessage(listed) };
  }
  const { records } = await registry.all();
  const open = new Set(
    records
      .filter((record) => record.closedAt === undefined)
      .map((record) => record.name),
  );
  const dirs = [
    ...new Set([main, ...listed.map((terminal) => terminal.cwd)]),
  ].sort();
  return {
    unmanaged: listed.filter(isUnmanaged).map((terminal) => ({
      terminal: terminal.id,
      role: terminal.labels["role"] ?? null,
    })),
    orphanReports: await orphansIn(deps, dirs, open),
  };
}
