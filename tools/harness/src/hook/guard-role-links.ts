import { lstatSync } from "node:fs";

/** Whether a path is an existing symlink or folder. A hook test name that is either is not a plain test file: a write through it lands somewhere else (#440, ADR 0100). A missing path is neither. */
export function isLinkOrFolder(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isSymbolicLink() || stat.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
