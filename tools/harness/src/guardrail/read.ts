import type { FileSystem } from "../runtime/index.js";
import {
  GuardrailError,
  INVENTORY_PATH,
  parseInventory,
  type Inventory,
} from "./inventory.js";

/** Reads and checks the inventory under a repository root; a missing file names its path. */
export async function readInventory(
  readFile: FileSystem["readFile"],
  root: string,
): Promise<Inventory> {
  let text: string;
  try {
    text = await readFile(`${root}/${INVENTORY_PATH}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    throw new GuardrailError(
      `${INVENTORY_PATH} is missing, so no guard rule has a declared mode. Restore it from git, then rerun.`,
    );
  }
  return parseInventory(text);
}
