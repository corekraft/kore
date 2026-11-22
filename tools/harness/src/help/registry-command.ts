import type {
  Command,
  CommandEffects,
  CommandExample,
  CommandHelp,
} from "../runtime/index.js";

/** Finds a command by its path (`plan tick`, or a domain alone for its only command); undefined when there is none. */
export type Lookup = (path: string) => Command | undefined;

const isBlank = (text: string | undefined): boolean =>
  text === undefined || text.trim() === "";

const isSingleLine = (text: string): boolean => !/[\r\n]/.test(text);

/** Fields a writer must fill in, each a sentence or two. */
function fieldProblems(path: string, help: CommandHelp): string[] {
  return (["purpose", "when", "whenNot"] as const)
    .filter((field) => isBlank(help[field]))
    .map((field) => `${path}: help has an empty ${field}`);
}

/** Every declared flag has one description, no other flag has one, and each is one line. */
function flagProblems(
  path: string,
  command: Command,
  help: CommandHelp,
): string[] {
  const declared = Object.keys(command.options ?? {});
  const missing = declared
    .filter((name) => isBlank(help.flags[name]))
    .map((name) => `${path}: declared flag "--${name}" has no description`);
  const undeclared = Object.keys(help.flags)
    .filter((name) => !declared.includes(name))
    .map(
      (name) =>
        `${path}: help describes "--${name}", which the command does not declare`,
    );
  const multiLine = declared
    .filter((name) => {
      const text = help.flags[name];
      return text !== undefined && !isBlank(text) && !isSingleLine(text);
    })
    .map((name) => `${path}: description of "--${name}" is more than one line`);
  return [...missing, ...undeclared, ...multiLine];
}

/** A declared operand has a description, and an operand description needs a declared operand. */
function operandProblems(
  path: string,
  command: Command,
  help: CommandHelp,
): string[] {
  if (command.operand !== undefined && isBlank(help.operand)) {
    return [
      `${path}: declares operand "${command.operand}" but help has no description for it`,
    ];
  }
  if (command.operand === undefined && help.operand !== undefined) {
    return [
      `${path}: help describes an operand, which the command does not declare`,
    ];
  }
  return [];
}

/** The path a command line names: `harness <domain> <command>`, or the domain alone when no command word follows. */
function targetPath(words: readonly string[]): string {
  const domain = words[1] ?? "";
  const word = words[2];
  return word === undefined || word.startsWith("-")
    ? domain
    : `${domain} ${word}`;
}

/** One example: it starts `harness`, names a command the table has, uses only that command's flags, and says what it shows. */
function oneExampleProblems(
  path: string,
  example: CommandExample,
  lookup: Lookup,
): string[] {
  const words = example.command.split(/\s+/);
  if (words[0] !== "harness") {
    return [
      `${path}: example "${example.command}" does not start with "harness"`,
    ];
  }
  const target = lookup(targetPath(words));
  if (target === undefined) {
    return [`${path}: example "${example.command}" names an unknown command`];
  }
  const declared = new Set([
    "json",
    "help",
    ...Object.keys(target.options ?? {}),
  ]);
  const undeclared = words
    .filter((word) => word.startsWith("--"))
    .map((word) => word.slice(2).split("=")[0] ?? "")
    .filter((name) => !declared.has(name))
    .map(
      (name) =>
        `${path}: example "${example.command}" names undeclared flag "--${name}"`,
    );
  const shows = isBlank(example.shows)
    ? [`${path}: example "${example.command}" has no "shows" line`]
    : [];
  return [...undeclared, ...shows];
}

function exampleProblems(
  path: string,
  help: CommandHelp,
  lookup: Lookup,
): string[] {
  if (help.examples.length === 0) {
    return [`${path}: has no example`];
  }
  return help.examples.flatMap((example) =>
    oneExampleProblems(path, example, lookup),
  );
}

function seeAlsoProblems(
  path: string,
  help: CommandHelp,
  lookup: Lookup,
): string[] {
  return help.seeAlso
    .filter((ref) => lookup(ref) === undefined)
    .map((ref) => `${path}: see also "${ref}" is not a command`);
}

function exitProblems(path: string, help: CommandHelp): string[] {
  if (help.exits.length === 0) {
    return [`${path}: has no exit codes`];
  }
  const codes = help.exits.map((exit) => exit.code);
  const repeated = codes
    .filter((code, index) => codes.indexOf(code) !== index)
    .map((code) => `${path}: lists exit code ${code} twice`);
  const meaningless = help.exits
    .filter((exit) => isBlank(exit.meaning))
    .map((exit) => `${path}: exit code ${exit.code} has no meaning`);
  return [...repeated, ...meaningless];
}

function effectProblems(path: string, help: CommandHelp): string[] {
  const effects: CommandEffects = help.effects;
  const problems: string[] = [];
  if (effects.kind !== "read-only" && effects.kind !== "mutates") {
    problems.push(`${path}: effects kind is neither read-only nor mutates`);
  }
  if (isBlank(effects.detail)) {
    problems.push(`${path}: effects has no detail`);
  }
  return problems;
}

/** Every check on one command's help record, in the order a writer meets them. */
export function commandProblems(
  path: string,
  command: Command,
  help: CommandHelp,
  lookup: Lookup,
): string[] {
  return [
    ...fieldProblems(path, help),
    ...flagProblems(path, command, help),
    ...operandProblems(path, command, help),
    ...exampleProblems(path, help, lookup),
    ...seeAlsoProblems(path, help, lookup),
    ...exitProblems(path, help),
    ...effectProblems(path, help),
  ];
}
