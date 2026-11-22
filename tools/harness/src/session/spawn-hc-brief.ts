import { join } from "node:path";
import type { FileSystem } from "../runtime/index.js";

/** The longest brief one argv element carries: the kernel's limit for one argument (plan 16, Step 4). */
export const INLINE_BRIEF_BYTES = 128 * 1024;

/**
 * The prompt the session's exec wrapper receives: the brief itself when it fits one argv element, else the path of a
 * file under the main checkout's .kore/brief that holds all of it, named by the prompt.
 */
export async function briefOperand(
  fs: Pick<FileSystem, "writeFile">,
  main: string,
  name: string,
  brief: string,
): Promise<string> {
  if (Buffer.byteLength(brief) <= INLINE_BRIEF_BYTES) {
    return brief;
  }
  const path = join(main, ".kore", "brief", `${name}.md`);
  await fs.writeFile(path, brief);
  return `Your brief is longer than one command line can carry, so it is in ${path}. Read that file in full and do the work it describes.`;
}
