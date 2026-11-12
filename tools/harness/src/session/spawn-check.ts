import type { CommandContext } from "../runtime/index.js";
import { sessionNameError } from "./names.js";
import { FAILED, USAGE_ERROR } from "./output.js";
import { findResult, parseTimeout } from "./wait.js";

const REQUIRED = ["role", "model", "effort", "name", "brief"] as const;

export type Values = Record<(typeof REQUIRED)[number], string>;
export type Checked =
  | { values: Values; callerPane: string; timeoutMs: number }
  | { error: string; code: number };

/** Everything that can be refused is refused here, before any herdr call. */
export function check({ deps, options }: CommandContext): Checked {
  const usage = (error: string): Checked => ({ error, code: USAGE_ERROR });
  const missing = REQUIRED.find((flag) => typeof options[flag] !== "string");
  if (missing !== undefined) {
    return usage(`Missing --${missing}.`);
  }
  const given = options as Values;
  const nameError = sessionNameError(given.name);
  if (nameError !== undefined) {
    return usage(nameError);
  }
  if (findResult(given.brief) !== undefined) {
    return usage(
      'The brief has a line that is only a RESULT marker, which would end the wait early. Describe the marker in words instead, such as "end with the word RESULT, a colon, then done or blocked".',
    );
  }
  if (options.branch !== undefined && options.worktree !== true) {
    return usage("--branch only applies with --worktree.");
  }
  const timeoutMs = parseTimeout(options.timeout);
  if (typeof timeoutMs !== "number") {
    return usage(timeoutMs.error);
  }
  const callerPane = deps.env.HERDR_PANE_ID;
  if (deps.env.HERDR_ENV !== "1") {
    return {
      error:
        "Not inside Herdr (HERDR_ENV is not 1). Run this from a Herdr pane; no session was started.",
      code: FAILED,
    };
  }
  if (callerPane === undefined || callerPane === "") {
    return {
      error:
        "HERDR_PANE_ID is not set, so the session cannot broadcast back. Run this from a Herdr pane.",
      code: FAILED,
    };
  }
  return { values: given, callerPane, timeoutMs };
}
