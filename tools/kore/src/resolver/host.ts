// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { Resolver } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import type { ResolverHost } from "./resolver.js";

const probeTimeoutMs = 2000;

/** The resolver file's text, or undefined when it does not exist. */
export async function readResolverFile(
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** Asks the platform DNS at one server, never the system resolver. */
export async function probeDns(
  name: string,
  server: { address: string; port: number },
): Promise<string[]> {
  const resolver = new Resolver({ timeout: probeTimeoutMs, tries: 1 });
  resolver.setServers([`${server.address}:${server.port}`]);
  return await resolver.resolve4(name);
}

/** Asks on the terminal; anything but yes is no. The prompt goes to stderr, keeping stdout clean. */
async function askOnTerminal(question: string): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    return /^y(es)?$/i.test((await readline.question(question)).trim());
  } finally {
    readline.close();
  }
}

/** The confirmation a command may ask, or none when there is no terminal to ask on. */
export function terminalConfirm(
  isTerminal: boolean,
): ((question: string) => Promise<boolean>) | undefined {
  return isTerminal ? askOnTerminal : undefined;
}

/** The host effects the resolver domain uses in a real run. */
export function systemResolverHost(): ResolverHost {
  return { read: readResolverFile, probe: probeDns };
}
