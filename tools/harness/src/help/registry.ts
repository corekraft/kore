import type { Command } from "../runtime/index.js";
import type { DomainGuide, RootGuide } from "./guide.js";
import { commandProblems, type Lookup } from "./registry-command.js";
import { guideProblems } from "./registry-guide.js";

export interface RegistryInput {
  domains: Record<string, Record<string, Command>>;
  guides: Record<string, DomainGuide>;
  root: RootGuide;
}

const isOneLine = (text: string): boolean =>
  text.trim() !== "" && !/[\r\n]/.test(text);

/** A command's path, and the domain alone for a domain's only command. */
function pairsIn(
  domains: Record<string, Record<string, Command>>,
): [string, Command][] {
  return Object.entries(domains).flatMap(([domain, commands]) =>
    Object.entries(commands).map(([name, command]): [string, Command] => [
      name === "" ? domain : `${domain} ${name}`,
      command,
    ]),
  );
}

/** Finds a command by path, using own keys only so a prototype name never resolves. */
function lookupIn(domains: Record<string, Record<string, Command>>): Lookup {
  return (path) => {
    const words = path.split(" ");
    const [domain = "", name = ""] = words;
    if (words.length > 2 || !Object.hasOwn(domains, domain)) {
      return undefined;
    }
    const table = domains[domain];
    return table !== undefined && Object.hasOwn(table, name)
      ? table[name]
      : undefined;
  };
}

/** One command: its summary, then either the rule that it has help, or its help checks. */
function pathProblems(
  path: string,
  command: Command,
  lookup: Lookup,
): string[] {
  const summary = isOneLine(command.summary)
    ? []
    : [`${path}: summary is empty or more than one line`];
  const help = command.help;
  if (help === undefined) {
    return [...summary, `${path}: has no help; write it beside the command`];
  }
  return [...summary, ...commandProblems(path, command, help, lookup)];
}

/**
 * The registry checks over a command table: every command has help and passes its checks,
 * and the guides and root flows resolve. Returns each problem; an empty list passes.
 */
export function registryProblems(input: RegistryInput): string[] {
  const lookup = lookupIn(input.domains);
  const commands = pairsIn(input.domains).flatMap(([path, command]) =>
    pathProblems(path, command, lookup),
  );
  const guides = guideProblems(
    { domains: input.domains, guides: input.guides, root: input.root },
    lookup,
  );
  return [...commands, ...guides];
}
