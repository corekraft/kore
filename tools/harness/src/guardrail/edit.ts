// Text edits of the inventory, one line per rule, so the file keeps its shape and
// its notes. Only `guardrail activate` calls them (plan 12, Step 4).

import { GuardrailError, INVENTORY_PATH } from "./inventory.js";

const MODE = /("mode"\s*:\s*")(audit|enforce)(")/;

function lineOf(lines: string[], rule: string): number {
  const at = lines.findIndex((line) => line.includes(`"rule": "${rule}"`));
  if (at < 0) {
    throw new GuardrailError(
      `${INVENTORY_PATH} has no line of its own for "${rule}". Keep one rule per line, then rerun.`,
    );
  }
  return at;
}

/** The inventory with one rule's mode set; every other byte stays. */
export function withMode(text: string, rule: string, mode: string): string {
  const lines = text.split("\n");
  const at = lineOf(lines, rule);
  const line = lines[at] ?? "";
  if (!MODE.test(line)) {
    throw new GuardrailError(
      `The "${rule}" line in ${INVENTORY_PATH} has no mode to set. Fix the line, then rerun.`,
    );
  }
  lines[at] = line.replace(MODE, `$1${mode}$3`);
  return lines.join("\n");
}

/** The inventory without one rule's line; the entry before keeps no comma when it becomes the last. */
export function withoutRule(text: string, rule: string): string {
  const lines = text.split("\n");
  const at = lineOf(lines, rule);
  const last = !(lines[at] ?? "").trimEnd().endsWith(",");
  lines.splice(at, 1);
  const before = lines[at - 1];
  if (last && before !== undefined && before.trimEnd().endsWith(",")) {
    lines[at - 1] = before.trimEnd().slice(0, -1);
  }
  return lines.join("\n");
}
