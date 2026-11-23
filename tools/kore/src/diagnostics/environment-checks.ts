import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import type { Check } from "./doctor.js";
import { registryNameCheck } from "./registry-name-check.js";
import { tokenSecretChecks } from "./token-secret-check.js";

/**
 * The read-only checks doctor runs against the environment's own cluster and
 * registry: the registry's name, then each token Secret whose consumer is on.
 */
export async function environmentChecks(
  repository: Repository,
  runner: Runner,
): Promise<Check[]> {
  return [
    ...(await registryNameCheck(repository, runner)),
    ...(await tokenSecretChecks(repository, runner)),
  ];
}
