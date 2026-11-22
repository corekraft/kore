import type { CommandContext } from "../runtime/index.js";
import type { Terminals } from "../terminal/index.js";
import { terminalsFor } from "./backend.js";
import { FAILED } from "./output.js";
import {
  emptyFlag,
  groupRefusal,
  leaseRefusal,
  type Refusal,
} from "./spawn-hc-gate.js";
import { checkRequest, type Requested } from "./spawn-check.js";
import { resolveParent, type Parent } from "./spawn-hc-parent.js";
import { reserve, type Reserved } from "./spawn-hc-place.js";

/** A request that may start on hc: its checked values, the parent it runs under, the terminals, and its place. */
export interface Admitted {
  requested: Extract<Requested, { values: unknown }>;
  parent: Parent;
  terminals: Terminals;
  reserved: Reserved;
  group?: string;
}

/** Every refusal that comes before a terminal exists: flags, the request, the writer gate, the group, the parent, then the name and place. */
export async function admit(
  context: CommandContext,
): Promise<Admitted | Refusal> {
  const { deps, options } = context;
  const empty = emptyFlag(options);
  if (empty !== undefined) {
    return empty;
  }
  const requested = await checkRequest(context);
  if ("error" in requested) {
    return requested;
  }
  const gate =
    (await leaseRefusal(deps, requested.values.role)) ??
    groupRefusal(options.group);
  if (gate !== undefined) {
    return gate;
  }
  const terminals = terminalsFor(deps);
  const parent = await resolveParent(terminals);
  if ("error" in parent) {
    return { error: parent.error, code: FAILED };
  }
  const reserved = await reserve(deps, options, requested.values.name);
  if ("error" in reserved) {
    return { error: reserved.error, code: FAILED };
  }
  return {
    requested,
    parent,
    terminals,
    reserved,
    ...(typeof options.group === "string" ? { group: options.group } : {}),
  };
}
