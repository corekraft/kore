import type { CommandContext } from "../runtime/index.js";
import { launchOf } from "./spawn-launch.js";
import { sessionNameError } from "./names.js";
import { USAGE_ERROR } from "./output.js";
import { launchStage, tierInputError, type TierOrigin } from "./tier-source.js";
import { parseTimeout } from "./wait.js";

const REQUIRED = ["role", "name", "brief"] as const;

/** Flags a role's agent definition can supply when the caller omits them. */
const TIER = ["model", "effort"] as const;

/** The roles whose ledger events must carry an idea; a reader's idea is optional. */
const IDEA_ROLES: readonly string[] = ["writer", "judge", "principles-review"];

/** A --no-idea reason the ledger keeps: 1 to 100 characters with no control characters. */
const REASON = /^[^\p{Cc}]{1,100}$/u;

export type Values = Record<
  (typeof REQUIRED)[number] | (typeof TIER)[number],
  string
>;
/** A request checked for everything but its caller: the values it runs with and the ledger marks. */
export type Requested =
  | {
      values: Values;
      timeoutMs: number;
      /** The idea the session works, as the ledger keys it (`#338`). */
      idea?: string;
      /** Where the tier came from, for the ledger's launch event. */
      tier: TierOrigin;
      /** The stage derived from the role, for the ledger's launch event. */
      stage?: string;
      /** Set when the spawn names no idea: no reason for a required role (which warns), or the --no-idea reason. */
      unstamped?: { reason?: string };
    }
  | { error: string; code: number };

/** A refusal: the message and the exit code it gets. */
type Refusal = { error: string; code: number };

/** The worktree flags' refusal: --branch needs --worktree, and a writer has its own so concurrent writers cannot collide. */
function worktreeError(
  role: string,
  options: Record<string, string | boolean | undefined>,
): string | undefined {
  if (options.branch !== undefined && options.worktree !== true) {
    return "--branch only applies with --worktree.";
  }
  return role === "writer" && options.worktree !== true
    ? "A writer needs its own worktree so concurrent writers cannot collide. Add --worktree."
    : undefined;
}

/** `338` or `#338` as `#338`; an error message for anything else; undefined when not given. */
function ideaOf(
  given: string | boolean | undefined,
): string | { error: string } | undefined {
  if (given === undefined) {
    return undefined;
  }
  const n = typeof given === "string" ? /^#?([1-9]\d{0,8})$/.exec(given) : null;
  return n?.[1] === undefined
    ? {
        error: `Invalid --idea "${String(given)}". Use an issue number such as 338 or #338.`,
      }
    : `#${n[1]}`;
}

/** The refusal for a --no-idea that comes with --idea, or whose reason the ledger would drop. */
function noIdeaError(options: CommandContext["options"]): string | undefined {
  const reason = options["no-idea"];
  if (reason === undefined) {
    return undefined;
  }
  if (options.idea !== undefined) {
    return "Use either --idea or --no-idea, not both.";
  }
  return typeof reason === "string" && REASON.test(reason)
    ? undefined
    : "Invalid --no-idea. Use 1 to 100 characters with no control characters.";
}

/** The first refusal among the brief, the worktree flags and the idea, before anything is resolved. */
function inputError(
  given: { role: string; brief: string },
  options: CommandContext["options"],
): string | undefined {
  const idea = ideaOf(options.idea);
  return (
    worktreeError(given.role, options) ??
    (typeof idea === "object" ? idea.error : undefined) ??
    noIdeaError(options) ??
    tierInputError(options)
  );
}

/** The unstamped mark for a spawn that names no idea: a required role with no reason warns; a --no-idea reason is recorded for any role. */
function unstampedOf(
  role: string,
  options: CommandContext["options"],
  idea: string | undefined,
): { reason?: string } | undefined {
  if (idea !== undefined) {
    return undefined;
  }
  const reason = options["no-idea"];
  if (typeof reason === "string") {
    return { reason };
  }
  return IDEA_ROLES.includes(role) ? {} : undefined;
}

/** Everything a request can be refused for, except its caller: usage, names, the brief, the timeout and the tier. */
export async function checkRequest({
  deps,
  options,
}: CommandContext): Promise<Requested> {
  const usage = (error: string): Refusal => ({ error, code: USAGE_ERROR });
  const missing = REQUIRED.find((flag) => typeof options[flag] !== "string");
  if (missing !== undefined) {
    return usage(`Missing --${missing}.`);
  }
  const given = options as Omit<Values, "model" | "effort">;
  const nameError = sessionNameError(given.name);
  if (nameError !== undefined) {
    return usage(nameError);
  }
  const wrongInput = inputError(given, options);
  if (wrongInput !== undefined) {
    return usage(wrongInput);
  }
  const timeoutMs = parseTimeout(options.timeout);
  if (typeof timeoutMs !== "number") {
    return usage(timeoutMs.error);
  }
  const launch = await launchOf(deps, given.role, options);
  if ("error" in launch) {
    return usage(launch.error);
  }
  // inputError has already refused a malformed idea.
  const idea = ideaOf(options.idea) as string | undefined;
  const stage = launchStage(
    given.role,
    typeof options.pr === "string" ? options.pr : undefined,
  );
  const unstamped = unstampedOf(given.role, options, idea);
  return {
    values: { ...given, model: launch.model, effort: launch.effort },
    tier: launch.origin,
    timeoutMs,
    ...(idea === undefined ? {} : { idea }),
    ...(stage === undefined ? {} : { stage }),
    ...(unstamped === undefined ? {} : { unstamped }),
  };
}
