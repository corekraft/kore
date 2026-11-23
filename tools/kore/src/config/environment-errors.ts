import { gatewayErrors } from "./gateways.js";
import { platformDomainErrors } from "./platform-domain.js";
import { registryAddressErrors } from "./registry-address.js";
import type { Repository } from "./types.js";

/**
 * Errors of the environment's fields that are written once and derived
 * everywhere else: the registry address (ADR 0031), the platform domain and
 * organization identifier (ADR 0042), and the Gateways and internal domain
 * (spec #1612).
 */
export function environmentFieldErrors(repository: Repository): string[] {
  return [
    ...registryAddressErrors(repository),
    ...platformDomainErrors(repository.environment),
    ...gatewayErrors(repository.environment),
  ];
}
