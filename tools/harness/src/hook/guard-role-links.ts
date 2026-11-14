import { lstatSync, type Stats } from "node:fs";

/** The stat of a path, or null when it does not exist. */
function statOf(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** Whether a path is an existing symlink. */
export const isSymlink = (path: string): boolean =>
  statOf(path)?.isSymbolicLink() ?? false;

/** Whether a path is an existing symlink or folder. A hook test name that is either is not a plain test file: a write through it lands somewhere else (#440, ADR 0100). A missing path is neither. */
export function isLinkOrFolder(path: string): boolean {
  const stat = statOf(path);
  return stat !== null && (stat.isSymbolicLink() || stat.isDirectory());
}

/** Whether a path is an existing regular file: not missing, a link, a folder, a pipe or a socket. */
export const isRegularFile = (path: string): boolean =>
  statOf(path)?.isFile() ?? false;
