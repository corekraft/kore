// The main-session setup lines of the flow report's text (#1046): the cap the labels were read
// against, then each stretch with its model, largest prompt and derived label.

import type { FlowReport, Stretch } from "../flow/index.js";

function stretchLine(stretch: Stretch): string {
  const model = stretch.model ?? "no model";
  const prompt = stretch.largestPrompt ?? "none";
  const reason = stretch.reason === undefined ? "" : ` (${stretch.reason})`;
  return `  ${stretch.session} ${model}, largest prompt ${prompt}: ${stretch.label}${reason}`;
}

/** Each main-session stretch with its derived setup, or why none is read; the cap reads "not set" when the config sets none. */
export function setupLines(setups: FlowReport["mainSessionSetups"]): string[] {
  if (setups.status === "insufficient") {
    return [`Main-session setups: insufficient, ${setups.reason}`];
  }
  const cap = setups.compactionCap ?? "not set";
  return [
    `Main-session setups (compaction cap ${cap}):`,
    ...setups.stretches.map(stretchLine),
  ];
}
