// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import type { Environment } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import {
  installResolver,
  resolverState,
  resolverTarget,
  type ResolverHost,
} from "./resolver.js";

export interface EnsureOptions {
  /** Asks the operator before elevated rights; absent when there is no terminal. */
  confirm?: ((question: string) => Promise<boolean>) | undefined;
}

export type EnsureResult =
  | { status: "unchanged" | "installed" | "updated"; path: string }
  | { status: "skipped" | "foreign"; path: string; next: string };

/**
 * Brings the host resolver file up to date for `kore local up`: the install
 * `kore dns install` runs, asked on the terminal. A correct file is left
 * alone, a file without the Kore marker is reported and never touched, and
 * with no terminal nothing is asked or written. A declined or failed install
 * throws with its cause (ADR 0132).
 */
export async function ensureResolver(
  environment: Environment,
  runner: Runner,
  host: ResolverHost,
  options: EnsureOptions,
): Promise<EnsureResult> {
  const target = resolverTarget(environment);
  const state = resolverState(target, await host.read(target.path));
  if (state === "current") {
    return { status: "unchanged", path: target.path };
  }
  if (state === "foreign") {
    return {
      status: "foreign",
      path: target.path,
      next: `${target.path} exists and was not written by kore, so it was left alone; move it aside, then run kore dns install --environment ${environment.name}`,
    };
  }
  if (options.confirm === undefined) {
    return {
      status: "skipped",
      path: target.path,
      next: `no terminal to ask on, so ${target.path} was not installed; run kore dns install --environment ${environment.name} in a terminal to make ${target.zone} names resolve`,
    };
  }
  return await installResolver(environment, runner, host, {
    yes: false,
    confirm: options.confirm,
  });
}
