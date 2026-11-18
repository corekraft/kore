// The flow report's time, issue and effort flags, parsed before anything is read: each refusal says
// what is wrong and the values that are allowed.

import { EFFORTS, isTimestamp, type Effort } from "../ledger/index.js";
import type { CommandContext } from "../runtime/index.js";

function parseTime(
  options: CommandContext["options"],
  name: string,
): Date | undefined | { error: string } {
  const given = options[name];
  if (given === undefined) {
    return undefined;
  }
  if (typeof given !== "string" || !isTimestamp(given)) {
    return {
      error: `Invalid --${name} "${String(given)}". Use an ISO 8601 UTC time such as 2026-01-02T03:04:05Z.`,
    };
  }
  return new Date(given);
}

/** `#12,13` to `["#12", "#13"]`; an error for anything that is not an issue number. */
export function parseIdeas(
  given: string | boolean,
): string[] | { error: string } {
  const parts = typeof given === "string" ? given.split(",") : [""];
  const ideas = parts.map((part) => /^#?(\d+)$/.exec(part.trim())?.[1]);
  if (ideas.includes(undefined)) {
    return {
      error: `Invalid --idea "${String(given)}". Use issue numbers such as #12 or 12,13.`,
    };
  }
  return ideas.map((n) => `#${Number(n)}`);
}

type Times =
  | { asOf?: Date; since?: Date; until?: Date; splitAt?: Date }
  | { error: string };

/** Why a split date is outside the range, or undefined when it is inside it (a bound itself is inside). */
function splitOutsideRange(
  splitAt: Date,
  since: Date | undefined,
  until: Date | undefined,
): string | undefined {
  if (since !== undefined && splitAt < since) {
    return `Invalid --split-at ${splitAt.toISOString()}: it is before --since ${since.toISOString()}. Use a date inside the range, or move --since earlier.`;
  }
  if (until !== undefined && splitAt > until) {
    return `Invalid --split-at ${splitAt.toISOString()}: it is after --until ${until.toISOString()}. Use a date inside the range, or move --until later.`;
  }
  return undefined;
}

function parseTimes(options: CommandContext["options"]): Times {
  const asOf = parseTime(options, "as-of");
  const since = parseTime(options, "since");
  const until = parseTime(options, "until");
  const splitAt = parseTime(options, "split-at");
  if (asOf !== undefined && "error" in asOf) {
    return asOf;
  }
  if (since !== undefined && "error" in since) {
    return since;
  }
  if (until !== undefined && "error" in until) {
    return until;
  }
  if (splitAt !== undefined && "error" in splitAt) {
    return splitAt;
  }
  if (since !== undefined && until !== undefined && since > until) {
    return {
      error: `Invalid --since ${since.toISOString()}: it is after --until ${until.toISOString()}. Swap them.`,
    };
  }
  const outside =
    splitAt === undefined
      ? undefined
      : splitOutsideRange(splitAt, since, until);
  if (outside !== undefined) {
    return { error: outside };
  }
  return {
    ...(asOf === undefined ? {} : { asOf }),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    ...(splitAt === undefined ? {} : { splitAt }),
  };
}

const isEffort = (value: string | boolean): value is Effort =>
  EFFORTS.some((effort) => effort === value);

type WindowFlags =
  | (Exclude<Times, { error: string }> & {
      windowEffort?: Effort;
    })
  | { error: string };

/** The report's time range, split date and window effort: --as-of, --since, --until, --split-at and --window-effort. */
export function parseWindowFlags(
  options: CommandContext["options"],
): WindowFlags {
  const times = parseTimes(options);
  const windowEffort = options["window-effort"];
  if ("error" in times) {
    return times;
  }
  if (windowEffort === undefined) {
    return times;
  }
  return isEffort(windowEffort)
    ? { ...times, windowEffort }
    : {
        error: `Invalid --window-effort "${String(windowEffort)}". Use one of ${EFFORTS.join(", ")}.`,
      };
}
