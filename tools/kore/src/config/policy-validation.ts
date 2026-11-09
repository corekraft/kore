import { imageTrustErrors } from "./image-trust.js";
import { policyPromotionErrors } from "./policy-promotion.js";
import type { Repository } from "./types.js";

/** Everything validation checks about who may sign and which policies may enforce. */
export async function policyErrors(repository: Repository): Promise<string[]> {
  return [
    ...imageTrustErrors(repository),
    ...(await policyPromotionErrors(repository)),
  ];
}
