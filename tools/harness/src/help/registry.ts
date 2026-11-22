import type { Command } from "../runtime/index.js";
import type { DomainGuide, RootGuide } from "./guide.js";
import { commandProblems, type Lookup } from "./registry-command.js";
import { guideProblems } from "./registry-guide.js";

export interface RegistryInput {
  domains: Record<string, Record<string, Command>>;
  guides: Record<string, DomainGuide>;
  root: RootGuide;
  /** Commands not yet documented (help/exemptions.ts), each by its path. */
  undocumented: readonly string[];
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

/** One command: its summary, then either its help checks, or the rule that it has help or is exempt. */
function pathProblems(
  path: string,
  command: Command,
  exempt: boolean,
  lookup: Lookup,
): string[] {
  const summary = isOneLine(command.summary)
    ? []
    : [`${path}: summary is empty or more than one line`];
  const help = command.help;
  if (help === undefined) {
    return exempt
      ? summary
      : [
          ...summary,
          `${path}: has no help; write it beside the command or list it in help/exemptions.ts`,
        ];
  }
  if (exempt) {
    return [
      ...summary,
      `${path}: has help but is still on the exemption list; remove its line`,
    ];
  }
  return [...summary, ...commandProblems(path, command, help, lookup)];
}

/**
 * The registry checks over a command table: every command has help or is exempt, a
 * command that has help is checked in full, no exemption names a missing command, and
 * the guides and root flows resolve. Returns each problem; an empty list passes.
 */
export function registryProblems(input: RegistryInput): string[] {
  const lookup = lookupIn(input.domains);
  const exempt = new Set(input.undocumented);
  const commands = pairsIn(input.domains).flatMap(([path, command]) =>
    pathProblems(path, command, exempt.has(path), lookup),
  );
  const stale = input.undocumented
    .filter((path) => lookup(path) === undefined)
    .map((path) => `exemption "${path}" is not a command in the table`);
  const guides = guideProblems(
    { domains: input.domains, guides: input.guides, root: input.root },
    lookup,
  );
  return [...commands, ...stale, ...guides];
}
