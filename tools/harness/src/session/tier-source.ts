import { join } from "node:path";
import { DEFAULT_LEDGER, Ledger, type TierOrigin } from "../ledger/index.js";
import { mainRoot, type CliDeps } from "../runtime/index.js";

export interface TierRequest {
  /** The --model flag, when the caller gave one. */
  model?: string | undefined;
  /** The --effort flag, when the caller gave one. */
  effort?: string | undefined;
  /** The PR the launch relaunches a writer for (--pr). */
  pr?: number | undefined;
  /** Why the caller overrode the definition (--reason). */
  reason?: string | undefined;
}

export type { TierOrigin };

/** Whether `queue escalate` recorded an escalation for the PR on this model. The event is keyed by PR, never by head. */
async function escalated(
  deps: CliDeps,
  pr: number,
  model: string,
): Promise<boolean> {
  try {
    const main = await mainRoot(deps);
    if (main === undefined) {
      return false;
    }
    const logged = await new Ledger(
      deps.fs,
      deps.clock,
      deps.ids,
      join(main, DEFAULT_LEDGER),
    ).list({ kind: "escalation" });
    return logged.events.some((e) => e.number === pr && e.label === model);
  } catch (error) {
    // A file-system fault (the ledger is unreadable) degrades to an override, as the ledger never gates a spawn; anything else is a bug and surfaces.
    if (typeof (error as NodeJS.ErrnoException).code === "string") {
      return false;
    }
    throw error;
  }
}

/**
 * Where a launch's tier came from. A flag-free launch uses the definition; a
 * model flag matching the PR's recorded escalation is an escalation; any other
 * flag is an override, carrying its reason when given. Never refuses.
 */
export async function tierSourceOf(
  deps: CliDeps,
  { model, effort, pr, reason }: TierRequest,
): Promise<TierOrigin> {
  if (model === undefined && effort === undefined) {
    return { tierSource: "definition" };
  }
  if (
    model !== undefined &&
    pr !== undefined &&
    (await escalated(deps, pr, model))
  ) {
    return { tierSource: "escalation" };
  }
  return {
    tierSource: "override",
    ...(reason === undefined ? {} : { tierReason: reason }),
  };
}

type Options = Record<string, string | boolean | undefined>;

const REASON = /^[^\p{Cc}]{1,100}$/u;

/** The refusal for a --pr that is not a pull request number, or a --reason the ledger would drop. */
export function tierInputError(options: Options): string | undefined {
  const { pr, reason } = options;
  if (
    pr !== undefined &&
    !(typeof pr === "string" && /^[1-9]\d{0,8}$/.test(pr))
  ) {
    return `Invalid --pr "${String(pr)}". Use a pull request number such as 612.`;
  }
  return reason === undefined ||
    (typeof reason === "string" && REASON.test(reason))
    ? undefined
    : "Invalid --reason. Use 1 to 100 characters with no control characters.";
}

/** Where the launch's tier came from, from spawn's flags; tierInputError has already refused a malformed --pr or --reason. */
export function tierOf(deps: CliDeps, options: Options): Promise<TierOrigin> {
  const text = (name: string) =>
    typeof options[name] === "string" ? options[name] : undefined;
  const pr = text("pr");
  return tierSourceOf(deps, {
    model: text("model"),
    effort: text("effort"),
    pr: pr === undefined ? undefined : Number(pr),
    reason: text("reason"),
  });
}
