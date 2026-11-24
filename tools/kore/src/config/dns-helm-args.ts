// Docs: docs/decisions/0161-cert-manager-solves-dns-01-through-cloudflare-and-issues-per-suborg-wildcards-behind-acme-dns01.md, docs/decisions/0162-external-dns-publishes-route-records-for-the-external-gateway-behind-external-dns.md
import { acmeDns01HelmArgs } from "./acme-dns01.js";
import { externalDnsHelmArgs } from "./external-dns.js";
import type { Environment } from "./types.js";

/**
 * The Helm arguments the two DNS-facing flags add to a component: external-dns
 * (ADR 0162) and acme-dns01 (ADR 0161). Each returns none while its flag is off
 * or for another component, so the flags off render what they rendered before.
 */
export function dnsHelmArgs(
  environment: Environment,
  component: string,
  env: NodeJS.ProcessEnv,
  suborgs: readonly string[] = [],
): string[] {
  return [
    ...externalDnsHelmArgs(environment, component, env),
    ...acmeDns01HelmArgs(environment, component, env, suborgs),
  ];
}
