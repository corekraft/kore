// The categorised send-back minimum of the harness config (#1094): the fewest categorised
// send-backs a window needs before the share of `other` is read over or within its threshold. A
// key the config leaves out takes the default; a value that is not a whole number of at least 1
// fails with the file, the key and the fix.

import { DEFAULT_MIN_CATEGORISED_SEND_BACKS } from "./cost.js";

/** The config key, under `cost`. */
const KEY = "cost.minCategorisedSendBacks";

/** The minimum from the config's `cost.minCategorisedSendBacks`, the default when it is left out, or the failure naming the key and the fix. */
export function minCategorisedSendBacksOf(
  file: string,
  value: unknown,
): number | { error: string } {
  if (value === undefined) {
    return DEFAULT_MIN_CATEGORISED_SEND_BACKS;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1) {
    return value;
  }
  return {
    error: `Invalid ${file}: key "${KEY}" must be a whole number of at least 1 (${DEFAULT_MIN_CATEGORISED_SEND_BACKS} is proposed). Fix the value, or remove the key to use ${DEFAULT_MIN_CATEGORISED_SEND_BACKS}.`,
  };
}
