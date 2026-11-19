// Docs: docs/decisions/0132-local-names-resolve-through-platform-dns-and-one-loopback-entry-point.md
export { resolverChecks } from "./checks.js";
export { ensureResolver } from "./ensure.js";
export type { EnsureResult } from "./ensure.js";
export type { ResolverFinding } from "./checks.js";
export { systemResolverHost, terminalConfirm } from "./host.js";
export {
  installResolver,
  isPrivateUseDomain,
  resolverDirectory,
  resolverMarker,
  resolverState,
  resolverTarget,
  uninstallResolver,
} from "./resolver.js";
export type {
  ResolverHost,
  ResolverOptions,
  ResolverResult,
  ResolverState,
  ResolverTarget,
} from "./resolver.js";
