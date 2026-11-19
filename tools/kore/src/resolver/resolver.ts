// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import { platformPlan } from "../config/index.js";
import type { Environment } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

/** The macOS resolver directory; each file in it names one zone (ADR 0132). */
export const resolverDirectory = "/etc/resolver";

/** The first line of every file kore writes; only a file carrying it is kore's. */
export const resolverMarker =
  "# Managed by kore dns install; kore dns uninstall removes this file.";

const platformDnsFlag = "platform-dns";

/** Top-level domains reserved for private use: no public registrant answers them. */
const privateUseSuffixes = new Set([
  "internal",
  "local",
  "test",
  "localhost",
  "example",
  "invalid",
]);

export interface ResolverTarget {
  path: string;
  zone: string;
  nameserver: string;
  port: number;
  content: string;
}

export type ResolverState = "absent" | "current" | "outdated" | "foreign";

/** The host reads and probes; every other effect goes through the runner. */
export interface ResolverHost {
  /** The file's text, or undefined when it does not exist. */
  read(path: string): Promise<string | undefined>;
  /** Asks the platform DNS at `server` for `name`; returns the answered addresses. */
  probe(
    name: string,
    server: { address: string; port: number },
  ): Promise<string[]>;
}

export interface ResolverOptions {
  yes: boolean;
  /** Asks the operator before elevated rights; absent when there is no terminal. */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
}

export interface ResolverResult<Status extends string> {
  status: Status;
  path: string;
}

/**
 * The one file for the environment's platform domain: the zone and the
 * loopback address and port of the platform-dns UDP mapping in the overlay.
 */
export function resolverTarget(environment: Environment): ResolverTarget {
  const { domain } = platformPlan(environment);
  const mapping = (environment.k3d?.ports ?? []).find(
    (port) => port.featureFlag === platformDnsFlag && port.protocol === "udp",
  );
  if (mapping === undefined) {
    throw new Error(
      `environment ${environment.name} declares no platform-dns UDP port in k3d.ports; add the loopback UDP mapping with featureFlag platform-dns (ADR 0132)`,
    );
  }
  const nameserver = mapping.hostAddress;
  const port = mapping.hostPort;
  return {
    path: `${resolverDirectory}/${domain}`,
    zone: domain,
    nameserver,
    port,
    content: `${resolverMarker}\nnameserver ${nameserver}\nport ${port}\n`,
  };
}

/** Compares what is on disk with what the environment expects; no write. */
export function resolverState(
  target: ResolverTarget,
  current: string | undefined,
): ResolverState {
  if (current === undefined) {
    return "absent";
  }
  if (current === target.content) {
    return "current";
  }
  return current.split("\n").includes(resolverMarker) ? "outdated" : "foreign";
}

/** Whether a domain sits under a reserved private-use suffix, so no public DNS answers it. */
export function isPrivateUseDomain(domain: string): boolean {
  return privateUseSuffixes.has(domain.slice(domain.lastIndexOf(".") + 1));
}

async function confirmElevated(
  options: ResolverOptions,
  question: string,
  declined: string,
  needsTerminal: string,
): Promise<void> {
  if (options.yes) {
    return;
  }
  if (options.confirm === undefined) {
    throw new Error(needsTerminal);
  }
  if (!(await options.confirm(question))) {
    throw new Error(declined);
  }
}

export async function installResolver(
  environment: Environment,
  runner: Runner,
  host: ResolverHost,
  options: ResolverOptions,
): Promise<ResolverResult<"installed" | "updated" | "unchanged">> {
  const target = resolverTarget(environment);
  const state = resolverState(target, await host.read(target.path));
  if (state === "current") {
    return { status: "unchanged", path: target.path };
  }
  if (state === "foreign") {
    throw new Error(
      `${target.path} exists and was not written by kore; move it aside, then run kore dns install again`,
    );
  }
  await confirmElevated(
    options,
    `kore dns install will write ${target.path} with sudo (mkdir -p ${resolverDirectory}, then tee):\n${target.content}Continue? [y/N] `,
    `kore dns install was not confirmed; nothing was written to ${target.path}`,
    "kore dns install needs a terminal to confirm sudo use; run it in a terminal or pass --yes",
  );
  await runner.run("sudo", ["mkdir", "-p", resolverDirectory], {
    capture: true,
  });
  await runner.run("sudo", ["tee", target.path], {
    capture: true,
    input: target.content,
  });
  return {
    status: state === "absent" ? "installed" : "updated",
    path: target.path,
  };
}

export async function uninstallResolver(
  environment: Environment,
  runner: Runner,
  host: ResolverHost,
  options: ResolverOptions,
): Promise<ResolverResult<"removed" | "absent">> {
  const target = resolverTarget(environment);
  const state = resolverState(target, await host.read(target.path));
  if (state === "absent") {
    return { status: "absent", path: target.path };
  }
  if (state === "foreign") {
    throw new Error(
      `${target.path} exists and was not written by kore; it is left in place`,
    );
  }
  await confirmElevated(
    options,
    `kore dns uninstall will remove ${target.path} with sudo (rm -f). Continue? [y/N] `,
    `kore dns uninstall was not confirmed; ${target.path} is left in place`,
    "kore dns uninstall needs a terminal to confirm sudo use; run it in a terminal or pass --yes",
  );
  await runner.run("sudo", ["rm", "-f", "--", target.path], { capture: true });
  return { status: "removed", path: target.path };
}
