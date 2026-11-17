import { JudgeError } from "../judge/index.js";
import type { FileSystem } from "../runtime/index.js";
import { readTextOption } from "./text-option.js";

/** The `--body` and `--body-file` values as the command line gave them. */
export interface PrBodyInput {
  inline: string | boolean | undefined;
  file: string | boolean | undefined;
}

/** What the body file is read through: the injected file system and the working directory. */
export interface PrBodySource {
  fs: Pick<FileSystem, "readFile">;
  cwd: string;
}

/**
 * The body `pr open` posts: the --body text, or the --body-file text exactly as the file holds
 * it. Refuses a body source it cannot use, before gh is reached: both flags together, a file
 * flag with no path, and a missing, unreadable or empty file. Reads only; writes nothing.
 */
export async function readPrBody(
  input: PrBodyInput,
  source: PrBodySource,
): Promise<string> {
  const read = await readTextOption(
    {
      name: "body",
      value: "<summary>",
      noun: "body",
      rerun: "`harness pr open`",
    },
    { inline: input.inline, file: input.file },
    source,
  );
  if ("error" in read) {
    throw new JudgeError(read.error);
  }
  return read.text;
}
