// The harness commands and flags a current document names must exist, read against the command table.
// Docs: infra/plans/17-harness-help-guide.md#step-1-help-guide

import { harnessMentions, type HarnessMention } from "../help/index.js";
import type { CommandTable } from "../runtime/index.js";
import { checkedLines } from "./command-scope.js";
import { finding, type Finding } from "./markdown.js";
import { nearest } from "./nearest.js";

/** Flags every harness command takes, so a document may name them after any command. */
const GLOBAL_FLAGS = ["json"];

const own = <T>(
  table: Readonly<Record<string, T>>,
  key: string,
): T | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);

/** Each command as the words that name it: `pr open`, or the domain alone for its only command. */
function namesOf(commands: CommandTable): string[] {
  return Object.entries(commands).flatMap(([domain, table]) =>
    Object.keys(table).map((name) =>
      name === "" ? domain : `${domain} ${name}`,
    ),
  );
}

/** The problems one mention of a harness command has: an unknown command, or a flag it does not declare. */
function mentionProblems(
  file: string,
  mention: HarnessMention,
  commands: CommandTable,
  names: readonly string[],
): Finding[] {
  const { line, flags } = mention;
  const [domain, name] = mention.words;
  if (domain === undefined) {
    return [];
  }
  const reference = mention.words.join(" ");
  const table = own(commands, domain);
  if (table !== undefined && name === undefined) {
    return [];
  }
  const command =
    table === undefined || name === undefined ? undefined : own(table, name);
  if (command === undefined) {
    const near = nearest(reference, names);
    return [
      finding(
        file,
        line,
        `harness ${reference} is not a harness command`,
        near === undefined
          ? "run harness --help to list the commands"
          : `use harness ${near}, the nearest real command`,
      ),
    ];
  }
  const declared = [...Object.keys(command.options ?? {}), ...GLOBAL_FLAGS];
  return flags
    .filter((flag) => !declared.includes(flag))
    .map((flag) => {
      const near = nearest(flag, declared);
      return finding(
        file,
        line,
        `harness ${reference} has no --${flag} flag`,
        near === undefined
          ? `run harness ${reference} --help to list its flags`
          : `use --${near}, a flag it declares`,
      );
    });
}

/** Every harness command or flag a current document names that the command table does not have. */
export function commandProblems(
  file: string,
  text: string,
  commands: CommandTable,
): Finding[] {
  const checked = checkedLines(file, text);
  const names = namesOf(commands);
  return harnessMentions(text)
    .filter((mention) => checked(mention.line))
    .flatMap((mention) => mentionProblems(file, mention, commands, names));
}

/** The command table a tree gives; absent, no harness command is checked. */
export interface CommandDeps {
  commands?(): CommandTable | undefined;
}

/** The tree the command check reads: its text by path, and the command table. */
export interface CommandTree extends CommandDeps {
  read(path: string): string | null;
}

/** The command problems of every Markdown file the tree gives; none when it gives no command table. */
export function commandFindings(
  tree: CommandTree,
  files: readonly string[],
): Finding[] {
  const commands = tree.commands?.();
  if (commands === undefined) {
    return [];
  }
  return files
    .filter((name) => name.endsWith(".md"))
    .flatMap((file) => {
      const text = tree.read(file);
      return text === null ? [] : commandProblems(file, text, commands);
    });
}
