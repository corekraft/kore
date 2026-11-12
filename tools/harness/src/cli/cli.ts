import { domains, type CliDeps, type Command } from "./domains.js";

export type { CliDeps };

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

function fail(deps: CliDeps, message: string): number {
  deps.stderr(`${message}\n\n${usage()}`);
  return USAGE_ERROR;
}

function names(commands: Record<string, Command>): string {
  return Object.keys(commands).join(", ");
}

/** Dispatches `<domain> <command> [--json]` and returns the process exit code. */
export async function run(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const flags = argv.filter((a) => a.startsWith("-"));
  const words = argv.filter((a) => !a.startsWith("-"));
  const unknown = flags.find((f) => !["--json", "--help", "-h"].includes(f));
  if (unknown !== undefined) {
    return fail(deps, `Unknown flag "${unknown}".`);
  }
  const help = flags.includes("--help") || flags.includes("-h");
  const [domain, name] = words;
  if (domain === undefined) {
    deps.stdout(usage());
    return 0;
  }
  const commands = domains[domain];
  if (commands === undefined) {
    return fail(
      deps,
      `Unknown domain "${domain}". Domains: ${Object.keys(domains).join(", ")}.`,
    );
  }
  if (help) {
    deps.stdout(usage());
    return 0;
  }
  if (name === undefined) {
    return fail(
      deps,
      `Missing command for domain "${domain}". Commands: ${names(commands)}.`,
    );
  }
  const command = commands[name];
  if (command === undefined) {
    return fail(
      deps,
      `Unknown command "${name}" for domain "${domain}". Commands: ${names(commands)}.`,
    );
  }
  return await command.run({ json: flags.includes("--json"), deps });
}
