import { gatewayErrors } from "./gateways.js";
import { externalDnsComponent, externalDnsErrors } from "./external-dns.js";
import { nodeCapacityErrors } from "./node-capacity.js";
import { platformDomainErrors } from "./platform-domain.js";
import { registryAddressErrors } from "./registry-address.js";
import type { Repository } from "./types.js";

/**
 * Errors of the environment's fields that are written once and derived
 * everywhere else: the registry address (ADR 0031), the platform domain and
 * organization identifier (ADR 0042), the Gateways and internal domain
 * (spec #1612), and the node count, committed fraction and reserves of the
 * one-node budget (ADR 0152), and the run-time values external-dns needs while
 * it is on, refused before any mutation (ADR 0164).
 */
export function environmentFieldErrors(repository: Repository): string[] {
  return [
    ...registryAddressErrors(repository),
    ...platformDomainErrors(repository.environment),
    ...gatewayErrors(repository.environment),
    ...nodeCapacityErrors(repository.environment),
    ...externalDnsErrors(
      repository.environment,
      externalDnsComponent,
      process.env,
    ),
  ];
}
