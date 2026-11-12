import type { CliDeps, Command } from "../runtime/index.js";
import { domains } from "./domains.js";

const USAGE_ERROR = 2;

function usage(): string {
  const lines = ["Usage: harness <domain> <command> [--json]", "", "Commands:"];
  for (const [domain, commands] of Object.entries(domains)) {
    for (const [name, command] of Object.entries(commands)) {
      lines.push(`  harness ${domain} ${name}  ${command.summary}`);
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

function fail(deps: CliDeps, json: boolean, message: string): number {
  const prefix = json ? `${JSON.stringify({ error: message })}\n` : "";
  deps.stderr(`${prefix}${message}\n\n${usage()}`);
  return USAGE_ERROR;
}

/** Own keys only, so "constructor" or "__proto__" never resolve to a prototype member. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function names(commands: Record<string, Command>): string {
  return Object.keys(commands).join(", ");
}

type Resolved = { command: Command } | { error: string };

function resolve(
  domain: string,
  name: string | undefined,
  extra: string[],
): Resolved {
  const commands = own(domains, domain);
  if (commands === undefined) {
    return {
      error: `Unknown domain "${domain}". Domains: ${Object.keys(domains).join(", ")}.`,
    };
  }
  if (name === undefined) {
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
  if (extra.length > 0) {
    return { error: `Unexpected argument "${extra[0]}".` };
  }
  return { command };
}

/** Dispatches `<domain> <command> [--json]` and returns the process exit code. */
export async function run(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const flags = argv.filter((a) => a.startsWith("-"));
  const words = argv.filter((a) => !a.startsWith("-"));
  const json = flags.includes("--json");
  const unknown = flags.find((f) => !["--json", "--help", "-h"].includes(f));
  if (unknown !== undefined) {
    return fail(deps, json, `Unknown flag "${unknown}".`);
  }
  const [domain, name, ...extra] = words;
  const help = flags.includes("--help") || flags.includes("-h");
  if (domain === undefined || (help && own(domains, domain) !== undefined)) {
    deps.stdout(usage());
    return 0;
  }
  const resolved = resolve(domain, name, extra);
  if ("error" in resolved) {
    return fail(deps, json, resolved.error);
  }
  return await resolved.command.run({ json, deps });
}
