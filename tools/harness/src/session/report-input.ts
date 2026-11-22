import { resolve } from "node:path";
import type { CliDeps } from "../runtime/index.js";
import { isInsideReportDir, reportDirOf, type Report } from "./report-file.js";

export const USAGE =
  "session report --outcome done|blocked (--summary <text> | --summary - | --file <path>) [--plan <file> | --plan -]";

/** The summary as the flags gave it: the text itself, or the file that holds it. */
export type Summary = { text: string } | { file: string } | { stdin: true };

export interface Input {
  outcome: Report["outcome"];
  summary: Summary;
  plan?: string;
}

export type Failed = { error: string };

/** A file's text, or why it cannot be read. */
async function readText(
  deps: CliDeps,
  label: string,
  path: string,
): Promise<{ text: string } | Failed> {
  if (!(await deps.fs.exists(path))) {
    return { error: `${label} does not exist.` };
  }
  return { text: await deps.fs.readFile(path) };
}

/** The summary text: the flag's own text, stdin's, or a file that must sit under the report directory. */
async function summaryText(
  deps: CliDeps,
  cwd: string,
  summary: Summary,
  stdinText: string | undefined,
): Promise<{ text: string } | Failed> {
  if ("stdin" in summary) {
    return { text: stdinText ?? "" };
  }
  if ("text" in summary) {
    return summary;
  }
  const path = resolve(deps.cwd, summary.file);
  if (!(await isInsideReportDir(deps.fs, deps.links, cwd, path))) {
    return {
      error: `--file ${summary.file} is outside ${reportDirOf(cwd)}; a report reads its summary only from there. Write the summary file in that directory and pass it again.`,
    };
  }
  return readText(deps, `--file ${summary.file}`, path);
}

/** The value that reads standard input for --summary and --plan. */
export const STDIN = "-";

/** The refusal when --summary and --plan both name stdin, which is read once. */
export const bothStdinError = (usage: string): string =>
  `--summary and --plan cannot both read stdin, which is read once: ${usage}.`;

/**
 * The text a flag reads from stdin, read once and only when a flag names it: undefined when neither
 * --summary nor --plan does. An empty read is refused, naming the flag that read it.
 */
export async function stdinOf(
  deps: CliDeps,
  summaryAsks: boolean,
  plan: string | undefined,
  usage: string,
): Promise<{ text: string } | { error: string } | undefined> {
  if (!summaryAsks && plan !== STDIN) {
    return undefined;
  }
  const text = await deps.stdin();
  if (text.trim() === "") {
    const flag = summaryAsks ? "--summary -" : "--plan -";
    return { error: `${flag} read nothing on stdin: ${usage}.` };
  }
  return { text };
}

/** The summary, and the plan's text when the flags name one, or why either cannot be read. */
export async function contentOf(
  deps: CliDeps,
  cwd: string,
  input: Input,
): Promise<{ summary: string; plan?: string } | Failed> {
  const stdin = await stdinOf(
    deps,
    "stdin" in input.summary,
    input.plan,
    USAGE,
  );
  if (stdin !== undefined && "error" in stdin) {
    return stdin;
  }
  const summary = await summaryText(deps, cwd, input.summary, stdin?.text);
  if ("error" in summary) {
    return summary;
  }
  if (input.plan === undefined) {
    return { summary: summary.text };
  }
  const plan =
    input.plan === STDIN
      ? { text: stdin?.text ?? "" }
      : await readText(
          deps,
          `--plan ${input.plan}`,
          resolve(deps.cwd, input.plan),
        );
  return "error" in plan ? plan : { summary: summary.text, plan: plan.text };
}
