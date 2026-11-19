// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
import {
  featureEnabled,
  platformDnsFlag,
  type Repository,
} from "../config/index.js";
import {
  ensureResolver,
  systemResolverHost,
  terminalConfirm,
} from "../resolver/index.js";
import type { Runner } from "../runtime/index.js";

/**
 * Runs `work` after bringing the host resolver file up to date, when the
 * platform-dns flag is on (ADR 0132); with the flag off it only runs `work`.
 * The install happens first, so a refused or failed one fails fast, before
 * any cluster work. With no terminal nothing is asked: `work` finishes and
 * the next step is printed last, `kore doctor` also reporting the file.
 */
export async function withHostResolver<Result>(
  repository: Repository,
  runner: Runner,
  work: () => Promise<Result>,
): Promise<Result> {
  if (!featureEnabled(repository.environment, platformDnsFlag)) {
    return await work();
  }
  const resolved = await ensureResolver(
    repository.environment,
    runner,
    systemResolverHost(),
    { confirm: terminalConfirm(Boolean(process.stdin.isTTY)) },
  );
  if (resolved.status === "installed" || resolved.status === "updated") {
    process.stderr.write(
      `${resolved.status} the host resolver file ${resolved.path}\n`,
    );
  }
  const result = await work();
  if ("next" in resolved) {
    process.stderr.write(`next: ${resolved.next}\n`);
  }
  return result;
}
