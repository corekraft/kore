export interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

export function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index++) {
    const item = args[index]!;
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const equals = item.indexOf("=");
    if (equals > 2) {
      flags.set(item.slice(2, equals), item.slice(equals + 1));
      continue;
    }
    const key = item.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      index++;
    } else {
      flags.set(key, true);
    }
  }
  return { positional, flags };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}
export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}
export function requireEnvironment(args: ParsedArgs): string {
  const environment = stringFlag(args, "environment");
  if (!environment) {
    throw new Error("--environment is required for mutating commands");
  }
  return environment;
}
