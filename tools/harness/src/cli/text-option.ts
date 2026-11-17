import { resolve } from "node:path";

/**
 * A free-text option that a command also takes from a file: `--<name> <value>` inline, or
 * `--<name>-file <path>` with the text the agent wrote with the Write tool.
 */
export interface TextOption {
  /** The inline flag's name without dashes, such as "reason" for --reason. */
  readonly name: string;
  /** What the inline flag shows in the refusal, such as "<why>". */
  readonly value: string;
  /** What the text is, for the messages, such as "reason" or "body". */
  readonly noun: string;
  /** The command the owner reruns, quoted for the messages, such as "`harness judge send-back 42`". */
  readonly rerun: string;
}

/** The two forms as the command line gave them: the inline value and the file path. */
export interface TextOptionValues {
  readonly inline: string | boolean | undefined;
  readonly file: string | boolean | undefined;
}

/** What the file is read through: the injected file system and the working directory. */
export interface TextOptionSource {
  readonly fs: { readFile(path: string): Promise<string> };
  readonly cwd: string;
}

/** The text the command should use, or the one refusal that stops it before anything is posted. */
export type TextOptionResult =
  { readonly text: string } | { readonly error: string };

/** Error codes that mean the file is there but cannot be read as text. */
const UNREADABLE_CODES = ["EACCES", "EPERM", "EISDIR"];

/**
 * The text of one option, read from the inline value or from the file. The file text comes back
 * exactly as the file holds it; the caller trims it the way it trims inline text. Refuses, with a
 * message that names the flag and the fix, both forms together, a file flag with no path, and a
 * missing, unreadable or empty file. Reads only; writes nothing.
 */
export async function readTextOption(
  option: TextOption,
  values: TextOptionValues,
  source: TextOptionSource,
): Promise<TextOptionResult> {
  const { name, noun, rerun } = option;
  const inline =
    typeof values.inline === "string" && values.inline !== ""
      ? values.inline
      : undefined;
  if (values.file === undefined) {
    return { text: inline ?? "" };
  }
  if (inline !== undefined) {
    return {
      error: `--${name} and --${name}-file together are refused. Pass the text with --${name} ${option.value} or the path with --${name}-file <path>, not both.`,
    };
  }
  if (typeof values.file !== "string" || values.file === "") {
    return {
      error: `--${name}-file needs the path to a file that holds the ${noun}. Write the ${noun} with the Write tool, then pass its path as --${name}-file <path>.`,
    };
  }
  const path = values.file;
  let text: string;
  try {
    text = await source.fs.readFile(resolve(source.cwd, path));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        error: `--${name}-file ${path} does not exist. Write the ${noun} to that path with the Write tool, then rerun ${rerun}.`,
      };
    }
    if (code !== undefined && UNREADABLE_CODES.includes(code)) {
      return {
        error: `--${name}-file ${path} cannot be read (${code}). Make the file readable or write the ${noun} to it again with the Write tool, then rerun ${rerun}.`,
      };
    }
    throw error;
  }
  if (text.trim() === "") {
    return {
      error: `--${name}-file ${path} is empty. Write the ${noun} into it with the Write tool, then rerun ${rerun}.`,
    };
  }
  return { text };
}
