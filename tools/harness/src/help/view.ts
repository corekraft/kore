import type {
  Command,
  CommandEffects,
  CommandExample,
  CommandExit,
  CommandHelp,
} from "../runtime/index.js";
import type { DomainGuide, RootFlow, RootGuide } from "./guide.js";

/** The root level: what the harness is, each domain in one line, the common flows, and how to go deeper. */
export interface RootView {
  level: "root";
  what: string;
  domains: { name: string; purpose: string }[];
  flows: RootFlow[];
  deeper: string;
}

/** The domain level: the guide, and each of its commands by full path (a domain's only command is the domain alone). */
export interface DomainView {
  level: "domain";
  domain: string;
  purpose: string;
  flow: string;
  commands: { path: string; summary: string }[];
  seeAlso: string[];
}

export interface FlagView {
  name: string;
  kind: "string" | "boolean" | "list";
  description: string;
}

/** The command level: usage, purpose, flags, operand, examples, exit codes, effects and related commands. */
export interface CommandView {
  level: "command";
  path: string;
  summary: string;
  purpose: string;
  when: string;
  whenNot: string;
  usage: string;
  flags: FlagView[];
  operand?: { name: string; description: string };
  examples: CommandExample[];
  exits: CommandExit[];
  effects: CommandEffects;
  seeAlso: string[];
}

/** One help structure at any level; the prose and the JSON renderers both read it. */
export type HelpView = RootView | DomainView | CommandView;

/** A command's path: `plan tick`, or the domain alone for a domain's only command. */
function pathOf(domain: string, name: string): string {
  return name === "" ? domain : `${domain} ${name}`;
}

/** The usage line, from the declared operand and flags; the global --json and --help are not listed. */
function usageOf(path: string, command: Command): string {
  const operand = command.operand === undefined ? "" : ` <${command.operand}>`;
  const flags = Object.entries(command.options ?? {})
    .map(([name, kind]) =>
      kind === "boolean" ? ` [--${name}]` : ` [--${name} <value>]`,
    )
    .join("");
  return `harness ${path}${operand}${flags}`;
}

/** The root view: the guide's own text, and each domain of the guides in order with its one-line purpose. */
export function rootView(
  guide: RootGuide,
  guides: Record<string, DomainGuide>,
): RootView {
  return {
    level: "root",
    what: guide.what,
    domains: Object.entries(guides).map(([name, domain]) => ({
      name,
      purpose: domain.purpose,
    })),
    flows: guide.flows,
    deeper: guide.deeper,
  };
}

/** The domain view: the guide with each of the domain's commands, in table order. */
export function domainView(
  domain: string,
  commands: Record<string, Command>,
  guide: DomainGuide,
): DomainView {
  return {
    level: "domain",
    domain,
    purpose: guide.purpose,
    flow: guide.flow,
    commands: Object.entries(commands).map(([name, command]) => ({
      path: pathOf(domain, name),
      summary: command.summary,
    })),
    seeAlso: guide.seeAlso ?? [],
  };
}

/** The command view: the declared flags and operand, with the descriptions from the command's help record. */
export function commandView(
  path: string,
  command: Command,
  help: CommandHelp,
): CommandView {
  return {
    level: "command",
    path,
    summary: command.summary,
    purpose: help.purpose,
    when: help.when,
    whenNot: help.whenNot,
    usage: usageOf(path, command),
    flags: Object.entries(command.options ?? {}).map(([name, kind]) => ({
      name,
      kind,
      description: help.flags[name] ?? "",
    })),
    ...(command.operand === undefined
      ? {}
      : {
          operand: {
            name: command.operand,
            description: help.operand ?? "",
          },
        }),
    examples: help.examples,
    exits: help.exits,
    effects: help.effects,
    seeAlso: help.seeAlso,
  };
}
