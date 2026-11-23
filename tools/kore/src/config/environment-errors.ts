import { nodeCapacityErrors } from "./node-capacity.js";
import { platformDomainErrors } from "./platform-domain.js";
import { registryAddressErrors } from "./registry-address.js";
import type { Repository } from "./types.js";

/**
 * Errors of the environment's fields that are written once and derived
 * everywhere else: the registry address (ADR 0031), the platform domain and
 * organization identifier (ADR 0042), and the node count, committed fraction
 * and reserves of the one-node budget (ADR 0152).
 */
export function environmentFieldErrors(repository: Repository): string[] {
  return [
    ...registryAddressErrors(repository),
    ...platformDomainErrors(repository.environment),
    ...nodeCapacityErrors(repository.environment),
  ];
}
