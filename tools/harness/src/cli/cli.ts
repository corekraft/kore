import {
  commandView,
  domainGuides,
  domainView,
  renderJson,
  renderText,
  rootGuide,
  rootView,
  type HelpView,
} from "../help/index.js";
import {
  CommandError,
  type CliDeps,
  type Command,
  type CommandContext,
} from "../runtime/index.js";
import { domains } from "./domains.js";

const USAGE_ERROR = 2;
const FAILURE = 1;

/** The deepest level the words reach: the root, a domain, or one command of a domain. */
type Reach =
  | { level: "root" }
  | { level: "domain"; domain: string; commands: Record<string, Command> }
  | { level: "command"; domain: string; name: string; command: Command };

/** Own keys only, so "constructor" or "__proto__" never resolve to a prototype member. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * The deepest level the words reach. No domain, or an unknown one, reaches the root. A command
 * named, or a domain's only command reached from the domain alone, reaches that command; a
 * missing or unknown command reaches the domain.
 */
function reach(domain: string | undefined, name: string | undefined): Reach {
  const commands = domain === undefined ? undefined : own(domains, domain);
  if (domain === undefined || commands === undefined) {
    return { level: "root" };
  }
  const key = name ?? "";
  const command = own(commands, key);
  if (command === undefined) {
    return { level: "domain", domain, commands };
  }
  return { level: "command", domain, name: key, command };
}

/** The view of a level: the root guide, a domain's guide with its commands, or one command's help. */
function viewOf(found: Reach): HelpView {
  if (found.level === "root") {
    return rootView(rootGuide, domainGuides);
  }
  if (found.level === "domain") {
    const guide = own(domainGuides, found.domain);
    if (guide === undefined) {
      throw new Error(
        `Domain "${found.domain}" has no guide; add it to help/domain-guides.ts.`,
      );
    }
    return domainView(found.domain, found.commands, guide);
  }
  const path =
    found.name === "" ? found.domain : `${found.domain} ${found.name}`;
  return commandView(path, found.command, found.command.help);
}

/** A level's guide as prose, or as one JSON object under --json. */
function renderLevel(found: Reach, json: boolean): string {
  const view = viewOf(found);
  return json ? renderJson(view) : renderText(view);
}

/** The error for words that name no command: an unknown domain, or a domain's missing or unknown command. */
function unresolved(
  domain: string,
  name: string | undefined,
  found: Exclude<Reach, { level: "command" }>,
): string {
  if (found.level === "root") {
    return `Unknown domain "${domain}".`;
  }
  if (name === undefined) {
    return `Missing command for domain "${domain}".`;
  }
  return `Unknown command "${name}" for domain "${domain}".`;
}

/**
 * Prints the error line, with a JSON error object first under --json, then the guide of the
 * closest level the words reached, and returns the exit code.
 */
function fail(
  deps: CliDeps,
  json: boolean,
  message: string,
  code: number,
  found: Reach,
): number {
  const prefix = json ? `${JSON.stringify({ error: message })}\n` : "";
  deps.stderr(`${prefix}${message}\n\n${renderLevel(found, false)}`);
  return code;
}

type Parsed =
  | {
      options: Record<string, string | boolean>;
      lists?: Record<string, string[]>;
      operand?: string;
    }
  | { error: string };

/**
 * Keeps a value-taking flag's value: a "list" flag adds to every value given, in order;
 * any other keeps the last one given.
 */
function keep(
  kind: "string" | "list",
  name: string,
  value: string,
  options: Record<string, string | boolean>,
  lists: Record<string, string[]>,
): void {
  if (kind === "list") {
    lists[name] = [...(lists[name] ?? []), value];
  } else {
    options[name] = value;
  }
}

/** Parses the tokens left after domain and command against the command's declared flags. */
function parseOptions(command: Command, tokens: readonly string[]): Parsed {
  const options: Record<string, string | boolean> = {};
  const lists: Record<string, string[]> = {};
  let operand: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (!token.startsWith("--")) {
      if (command.operand === undefined || operand !== undefined) {
        return { error: `Unexpected argument "${token}".` };
      }
      operand = token;
      continue;
    }
    const [name = "", inline] = token.slice(2).split(/=(.*)/s, 2);
    const kind = own(command.options ?? {}, name);
    if (kind === undefined) {
      return { error: `Unknown flag "${token}".` };
    }
    if (kind === "boolean") {
      if (inline !== undefined) {
        return { error: `Flag "--${name}" takes no value.` };
      }
      options[name] = true;
      continue;
    }
    const value = inline ?? tokens[++i];
    if (value === undefined) {
      return { error: `Flag "--${name}" needs a value.` };
    }
    keep(kind, name, value, options, lists);
  }
  return {
    options,
    ...(Object.keys(lists).length > 0 ? { lists } : {}),
    ...(operand === undefined ? {} : { operand }),
  };
}

async function execute(
  command: Command,
  context: CommandContext,
): Promise<number> {
  try {
    return await command.run(context);
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    const { json, deps } = context;
    const prefix = json ? `${JSON.stringify({ error: error.message })}\n` : "";
    deps.stderr(`${prefix}${error.message}\n`);
    return FAILURE;
  }
}

/** Dispatches `<domain> <command> [flags]` and returns the process exit code. */
export async function run(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const json = argv.includes("--json");
  const help = argv.includes("--help") || argv.includes("-h");
  const words: number[] = [];
  argv.forEach((token, i) => {
    if (!token.startsWith("-") && words.length < 2) {
      words.push(i);
    }
  });
  const domain = argv[words[0] ?? -1];
  const name = argv[words[1] ?? -1];
  // Help wins over every flag and operand on the line, and needs no root, ledger or process:
  // it prints the deepest level the words reach, to stdout, with exit 0.
  if (help || domain === undefined) {
    deps.stdout(renderLevel(reach(domain, name), json));
    return 0;
  }
  const rest = argv.filter(
    (token, i) =>
      !words.includes(i) &&
      token !== "--json" &&
      token !== "--help" &&
      token !== "-h",
  );
  // Exit 1, not the usage error 2, for a hook: exit 2 from a PreToolUse hook
  // blocks every tool call, so a typo in settings.json must never stop the session.
  const failure = domain === "hook" ? FAILURE : USAGE_ERROR;
  const found = reach(domain, name);
  const early = argv
    .slice(0, words[1] ?? 0)
    .find((t) => t.startsWith("-") && !["--json", "--help", "-h"].includes(t));
  if (early !== undefined) {
    return fail(
      deps,
      json,
      `Put "${early}" after the command: harness <domain> <command> [flags].`,
      failure,
      found,
    );
  }
  if (found.level !== "command") {
    return fail(deps, json, unresolved(domain, name, found), failure, found);
  }
  const parsed = parseOptions(found.command, rest);
  if ("error" in parsed) {
    return fail(deps, json, parsed.error, failure, found);
  }
  return await execute(found.command, {
    json,
    options: parsed.options,
    ...("lists" in parsed ? { lists: parsed.lists } : {}),
    operand: parsed.operand,
    deps,
  });
}
