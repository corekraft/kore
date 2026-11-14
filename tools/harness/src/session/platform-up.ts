import { join } from "node:path";
import type { FileSystem } from "../runtime/index.js";

const LOCAL_JOURNAL = ".kore/state/journal/local.jsonl";
const DOWN = /\b(stop|down|destroy)\b/;

interface Entry {
  kind?: string;
  op?: string;
  command?: string;
  outcome?: string;
}

function entriesOf(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    try {
      const entry: unknown = JSON.parse(line);
      if (entry !== null && typeof entry === "object") {
        entries.push(entry as Entry);
      }
    } catch {
      // A torn line is not worth losing the sample.
    }
  }
  return entries;
}

/**
 * Whether the local platform was up: the local environment journal's last
 * operation is not a stop, down or destroy and did not fail. An operation still
 * running counts as up. No readable journal means not up.
 */
export async function platformUp(
  fs: Pick<FileSystem, "readFile">,
  root: string,
): Promise<boolean> {
  let text: string;
  try {
    text = await fs.readFile(join(root, LOCAL_JOURNAL));
  } catch {
    return false;
  }
  const entries = entriesOf(text);
  const start = entries.findLast((entry) => entry.kind === "start");
  if (start === undefined) {
    return false;
  }
  const end = entries.findLast(
    (entry) => entry.kind === "end" && entry.op === start.op,
  );
  return !DOWN.test(start.command ?? "") && end?.outcome !== "failed";
}
