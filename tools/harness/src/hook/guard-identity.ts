// The identity of the hc terminal a hook runs in (plan 16, Grilled Decisions 5). The session record that names
// the terminal gives the session's name, role and idea. hc confirms the record when it is reachable: the terminal
// must be live and named as the record says. With hc down, the record still gives the role, unchecked, so a
// guard keeps its role; a recording hook takes an identity only when hc confirmed it. HC_TERMINAL_ID is the one
// value read from the environment, and it only finds the record. When the terminal's own record cannot be read,
// the run carries a notice that names the file and the fix, and the guard keeps the role from the payload.
import { CommandError, type CliDeps } from "../runtime/index.js";
import {
  recordsOfTerminal,
  SessionRegistry,
  type TerminalRecords,
  type UnreadableRecord,
} from "../session/index.js";
import { HcTerminals, type Terminals } from "../terminal/index.js";

export interface SessionIdentity {
  name: string;
  role: string;
  idea?: string;
  /** True when hc confirmed the record; false when hc was unreachable. */
  checked: boolean;
}

/** HC_TERMINAL_ID, the terminal the hook runs in; undefined outside an hc terminal. */
export function hcTerminalId(deps: CliDeps): string | undefined {
  const id = deps.env["HC_TERMINAL_ID"];
  return id === undefined || id === "" ? undefined : id;
}

/** What one run resolves for its hc terminal: the confirmed identity, and a notice when the terminal's own record is unreadable. */
interface Resolved {
  identity?: SessionIdentity;
  notice?: string;
}

const resolutions = new WeakMap<CliDeps, Promise<Resolved>>();

/** The resolution of this run, looked up once so a guard, a notice and a recording hook share it. */
function resolutionOf(deps: CliDeps, terminals: Terminals): Promise<Resolved> {
  let found = resolutions.get(deps);
  if (found === undefined) {
    found = resolve(deps, terminals);
    resolutions.set(deps, found);
  }
  return found;
}

/** The identity of this run's hc terminal, looked up once per run so a guard and a recording hook share it. */
export function sessionIdentity(
  deps: CliDeps,
  terminals: Terminals = new HcTerminals({
    runner: deps.runner,
    env: deps.env,
  }),
): Promise<SessionIdentity | undefined> {
  return resolutionOf(deps, terminals).then((found) => found.identity);
}

/** The notice for this run's hc terminal when its own session record cannot be read; undefined otherwise. */
export function sessionNotice(
  deps: CliDeps,
  terminals: Terminals = new HcTerminals({
    runner: deps.runner,
    env: deps.env,
  }),
): Promise<string | undefined> {
  return resolutionOf(deps, terminals).then((found) => found.notice);
}

async function resolve(deps: CliDeps, terminals: Terminals): Promise<Resolved> {
  const id = hcTerminalId(deps);
  if (id === undefined) {
    return {};
  }
  let found: TerminalRecords;
  try {
    found = await recordsOfTerminal(await SessionRegistry.open(deps), id);
  } catch (error) {
    // No main checkout, or the registry cannot be opened: no identity, and the payload's role stands.
    if (error instanceof CommandError) {
      return {};
    }
    throw error;
  }
  const { record } = found;
  if (record === undefined) {
    const [own] = found.unreadable;
    return own === undefined ? {} : { notice: unreadableNotice(own, id) };
  }
  const identity = {
    name: record.name,
    role: record.role,
    ...(record.idea === undefined ? {} : { idea: record.idea }),
  };
  const live = await terminals.get(id);
  if ("error" in live) {
    return live.error.kind === "unavailable"
      ? { identity: { ...identity, checked: false } }
      : {};
  }
  return live.name === record.name
    ? { identity: { ...identity, checked: true } }
    : {};
}

/** Names the unreadable record and the fix, in the words the guard's other notices use. */
function unreadableNotice(record: UnreadableRecord, id: string): string {
  return `[guard] The session record ${record.file} for hc terminal ${id} cannot be read (${record.reason}), so the guard keeps the role from the call's payload. Fix it: remove that file, or spawn the session again with \`harness session spawn\`.`;
}
