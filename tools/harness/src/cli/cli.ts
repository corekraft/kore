import {
  CommandError,
  type CliDeps,
  type Command,
  type CommandContext,
} from "../runtime/index.js";
import { domains } from "./domains.js";

const USAGE_ERROR = 2;
const FAILURE = 1;

function usage(): string {
  const lines = ["Usage: harness <domain> <command> [--json]", "", "Commands:"];
  for (const [domain, commands] of Object.entries(domains)) {
    for (const [name, command] of Object.entries(commands)) {
      lines.push(
        `  harness ${[domain, name].filter(Boolean).join(" ")}  ${command.summary}`,
      );
    }
  }
  lines.push(
    "",
    "Flags:",
    "  --json  print machine-readable output",
    "  --help  show this usage",
  );
  return `${lines.join("\n")}\n`;
}

function fail(
  deps: CliDeps,
  json: boolean,
  message: string,
  code = USAGE_ERROR,
): number {
  const prefix = json ? `${JSON.stringify({ error: message })}\n` : "";
  deps.stderr(`${prefix}${message}\n\n${usage()}`);
  return code;
}

/** Own keys only, so "constructor" or "__proto__" never resolve to a prototype member. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function names(commands: Record<string, Command>): string {
  return Object.keys(commands).join(", ");
}

type Resolved = { command: Command } | { error: string };

function resolve(domain: string, name: string | undefined): Resolved {
  const commands = own(domains, domain);
  if (commands === undefined) {
    return {
      error: `Unknown domain "${domain}". Domains: ${Object.keys(domains).join(", ")}.`,
    };
  }
  if (name === undefined) {
    const only = own(commands, "");
    if (only !== undefined) {
      return { command: only };
    }
    return {
      error: `Missing command for domain "${domain}". Commands: ${names(commands)}.`,
    };
  }
  const command = own(commands, name);
  if (command === undefined) {
    return {
      error: `Unknown command "${name}" for domain "${domain}". Commands: ${names(commands)}.`,
    };
  }
  return { command };
}

type Parsed =
  | { options: Record<string, string | boolean>; operand?: string }
  | { error: string };

/** Parses the tokens left after domain and command against the command's declared flags. */
function parseOptions(command: Command, tokens: readonly string[]): Parsed {
  const spec = command.options ?? {};
  const options: Record<string, string | boolean> = {};
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
    const kind = own(spec, name);
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
    options[name] = value;
  }
  return operand === undefined ? { options } : { options, operand };
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
  if (domain === undefined || (help && own(domains, domain) !== undefined)) {
    deps.stdout(usage());
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
  const early = argv
    .slice(0, words[1] ?? 0)
    .find((t) => t.startsWith("-") && !["--json", "--help", "-h"].includes(t));
  if (early !== undefined) {
    return fail(
      deps,
      json,
      `Put "${early}" after the command: harness <domain> <command> [flags].`,
      failure,
    );
  }
  const resolved = resolve(domain, name);
  if ("error" in resolved) {
    return fail(deps, json, resolved.error, failure);
  }
  const parsed = parseOptions(resolved.command, rest);
  if ("error" in parsed) {
    return fail(deps, json, parsed.error, failure);
  }
  return await execute(resolved.command, {
    json,
    options: parsed.options,
    operand: parsed.operand,
    deps,
  });
}
