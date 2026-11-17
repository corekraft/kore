import { resolve } from "node:path";
import { JudgeError } from "../judge/index.js";
import type { FileSystem } from "../runtime/index.js";

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

/** Error codes that mean the file is there but cannot be read as a body. */
const UNREADABLE_CODES = ["EACCES", "EPERM", "EISDIR"];

/**
 * The body `pr open` posts: the --body text, or the --body-file text exactly as the file holds
 * it. Refuses a body source it cannot use, before gh is reached: both flags together, a file
 * flag with no path, and a missing, unreadable or empty file. Reads only; writes nothing.
 */
export async function readPrBody(
  input: PrBodyInput,
  source: PrBodySource,
): Promise<string> {
  const inline =
    typeof input.inline === "string" && input.inline !== ""
      ? input.inline
      : undefined;
  if (input.file === undefined) {
    return inline ?? "";
  }
  if (inline !== undefined) {
    throw new JudgeError(
      "--body and --body-file together are refused. Pass the text with --body <summary> or the path with --body-file <path>, not both.",
    );
  }
  if (typeof input.file !== "string" || input.file === "") {
    throw new JudgeError(
      "--body-file needs the path to a file that holds the body. Write the body with the Write tool, then pass its path as --body-file <path>.",
    );
  }
  const text = await readBodyFile(input.file, source);
  if (text.trim() === "") {
    throw new JudgeError(
      `--body-file ${input.file} is empty. Write the body into it with the Write tool, then rerun \`harness pr open\`.`,
    );
  }
  return text;
}

async function readBodyFile(
  path: string,
  source: PrBodySource,
): Promise<string> {
  try {
    return await source.fs.readFile(resolve(source.cwd, path));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new JudgeError(
        `--body-file ${path} does not exist. Write the body to that path with the Write tool, then rerun \`harness pr open\`.`,
      );
    }
    if (code !== undefined && UNREADABLE_CODES.includes(code)) {
      throw new JudgeError(
        `--body-file ${path} cannot be read (${code}). Make the file readable or write the body to it again with the Write tool, then rerun \`harness pr open\`.`,
      );
    }
    throw error;
  }
}
