// The identity of the hc terminal a hook runs in (plan 16, Grilled Decisions 5). The session record that names
// the terminal gives the session's name, role and idea. hc confirms the record when it is reachable: the terminal
// must be live and named as the record says. With hc down, the record still gives the role, unchecked, so a
// guard keeps its role; a recording hook takes an identity only when hc confirmed it. HC_TERMINAL_ID is the one
// value read from the environment, and it only finds the record.
import { CommandError, type CliDeps } from "../runtime/index.js";
import {
  recordOfTerminal,
  SessionRegistry,
  type SessionRecord,
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

const identities = new WeakMap<CliDeps, Promise<SessionIdentity | undefined>>();

/** The identity of this run's hc terminal, looked up once per run so a guard and a recording hook share it. */
export function sessionIdentity(
  deps: CliDeps,
  terminals: Terminals = new HcTerminals({
    runner: deps.runner,
    env: deps.env,
  }),
): Promise<SessionIdentity | undefined> {
  let found = identities.get(deps);
  if (found === undefined) {
    found = resolve(deps, terminals);
    identities.set(deps, found);
  }
  return found;
}

async function resolve(
  deps: CliDeps,
  terminals: Terminals,
): Promise<SessionIdentity | undefined> {
  const id = hcTerminalId(deps);
  if (id === undefined) {
    return undefined;
  }
  let record: SessionRecord | undefined;
  try {
    record = await recordOfTerminal(await SessionRegistry.open(deps), id);
  } catch (error) {
    // No main checkout, or a record this harness cannot read: no identity, and the payload's role stands.
    if (error instanceof CommandError) {
      return undefined;
    }
    throw error;
  }
  if (record === undefined) {
    return undefined;
  }
  const identity = {
    name: record.name,
    role: record.role,
    ...(record.idea === undefined ? {} : { idea: record.idea }),
  };
  const live = await terminals.get(id);
  if ("error" in live) {
    return live.error.kind === "unavailable"
      ? { ...identity, checked: false }
      : undefined;
  }
  return live.name === record.name ? { ...identity, checked: true } : undefined;
}
