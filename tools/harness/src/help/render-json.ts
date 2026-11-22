import type { HelpView } from "./view.js";

/** The same help structure as one JSON object on one line, as every other command prints JSON. */
export function renderJson(view: HelpView): string {
  return `${JSON.stringify(view)}\n`;
}
