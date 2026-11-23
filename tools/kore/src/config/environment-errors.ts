import { k3sPinErrors } from "./k3s-pin.js";
import { platformDomainErrors } from "./platform-domain.js";
import { registryAddressErrors } from "./registry-address.js";
import type { Repository } from "./types.js";

/**
 * Errors of the environment's fields that are written once and derived
 * everywhere else: the registry address (ADR 0031), the platform domain and
 * organization identifier (ADR 0042), and the k3s pin of the vps host against
 * the overlay's Kubernetes version (ADR 0141).
 */
export function environmentFieldErrors(repository: Repository): string[] {
  return [
    ...registryAddressErrors(repository),
    ...platformDomainErrors(repository.environment),
    ...k3sPinErrors(repository),
  ];
}
