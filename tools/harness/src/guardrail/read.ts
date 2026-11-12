import { dirname } from "node:path";
import type { FileSystem } from "../runtime/index.js";
import {
  MissingInventoryError,
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
    throw new MissingInventoryError(
      `${INVENTORY_PATH} is missing, so no guard rule has a declared mode. Restore it from git, then rerun.`,
    );
  }
  return parseInventory(text);
}

/**
 * Finds the inventory from a directory, walking up through its parents, so a
 * hook running in a subdirectory still finds the repository's inventory.
 */
export async function findInventory(
  readFile: FileSystem["readFile"],
  start: string,
): Promise<Inventory> {
  let dir = start;
  for (;;) {
    try {
      return await readInventory(readFile, dir);
    } catch (error) {
      const parent = dirname(dir);
      if (!(error instanceof MissingInventoryError)) {
        throw error;
      }
      if (parent === dir) {
        // Report against where the search began.
        return await readInventory(readFile, start);
      }
      dir = parent;
    }
  }
}
