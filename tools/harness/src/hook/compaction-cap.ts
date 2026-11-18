// The compaction cap the stop hook measures requests against (#1032): the harness config's
// compactionCap, read under the repository root. The hook is best effort, as the split reader
// is: a missing, unreadable or refused config gives no cap, so the stop never blocks on it.
// The reports refuse a bad config with its own message.

import { join } from "node:path";
import { HARNESS_CONFIG, parseHarnessConfig } from "../flow/index.js";
import type { FileSystem } from "../runtime/index.js";

/** The config's compaction cap, or undefined when the config sets none or cannot be used. */
export async function compactionCapOf(
  fs: FileSystem,
  root: string,
): Promise<number | undefined> {
  let text: string;
  try {
    text = await fs.readFile(join(root, HARNESS_CONFIG));
  } catch {
    return undefined;
  }
  const parsed = parseHarnessConfig(text, HARNESS_CONFIG);
  return "error" in parsed ? undefined : parsed.compactionCap;
}
