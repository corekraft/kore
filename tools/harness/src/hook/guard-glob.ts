import { glob } from "node:fs/promises";

/** Whether any path under `root` matches the shell glob; stops at the first match. */
export async function anyPathMatches(
  root: string,
  pattern: string,
): Promise<boolean> {
  for await (const path of glob(pattern, { cwd: root })) {
    return path.length > 0;
  }
  return false;
}
