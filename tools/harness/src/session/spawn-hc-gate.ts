import type { CliDeps } from "../runtime/index.js";
import { hostLeaseRefusal } from "./host-lease.js";
import { FAILED, USAGE_ERROR } from "./output.js";
import { spawnLoadRefusal } from "./spawn-load.js";

/** A refusal: its message and the exit code it gets. */
export interface Refusal {
  error: string;
  code: number;
}

const GROUP = /^[a-z0-9_-]{1,32}$/;
const EMPTY_FLAGS = ["role", "name"] as const;

/** A role or name flag given as an empty string: refused before anything is resolved. */
export function emptyFlag(
  options: Record<string, string | boolean>,
): Refusal | undefined {
  const empty = EMPTY_FLAGS.find((flag) => options[flag] === "");
  return empty === undefined
    ? undefined
    : { error: `Missing --${empty}.`, code: USAGE_ERROR };
}

/** The refusal for a --group hc labels cannot carry; none when the group is not given. */
export function groupRefusal(
  group: string | boolean | undefined,
): Refusal | undefined {
  if (group === undefined) {
    return undefined;
  }
  return typeof group === "string" && GROUP.test(group)
    ? undefined
    : {
        error: `Invalid --group "${String(group)}". Use lowercase letters, digits, "-" and "_", at most 32 characters.`,
        code: USAGE_ERROR,
      };
}

/** The refusal while a writer may not start: the host lease, then the host load. Other roles are never checked. */
export async function leaseRefusal(
  deps: CliDeps,
  role: string,
): Promise<Refusal | undefined> {
  if (role !== "writer") {
    return undefined;
  }
  const refused = (await hostLeaseRefusal(deps)) ?? spawnLoadRefusal(deps);
  return refused === undefined ? undefined : { error: refused, code: FAILED };
}
