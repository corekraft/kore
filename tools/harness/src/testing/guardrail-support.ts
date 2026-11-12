// The committed inventory, for specs that exercise the guard against today's modes.
import { readFileSync } from "node:fs";
import {
  INVENTORY_PATH,
  parseInventory,
  type Mode,
} from "../guardrail/index.js";

const repo = new URL("../../../../", import.meta.url).pathname;

export const committedInventoryText = readFileSync(
  `${repo}${INVENTORY_PATH}`,
  "utf8",
);
export const committedInventory = parseInventory(committedInventoryText);

/** The committed inventory with some rules moved to another mode. */
export function inventoryWith(modes: Record<string, Mode>): string {
  return JSON.stringify({
    guardrails: committedInventory.guardrails.map((g) => ({
      ...g,
      mode: modes[g.rule] ?? g.mode,
    })),
  });
}
