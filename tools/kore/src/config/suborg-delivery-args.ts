import { featureEnabled, suborgDeliveryProjectFlag } from "./features.js";
import type { Repository } from "./types.js";

/**
 * With suborg-delivery-project on (ADR 0165, issue 1553), the Kore repository URL the
 * platform-apis chart admits as the one source of each suborg's AppProject. It is composed
 * from the git origin before the platform renders (composeSuborgDelivery). Absent, none is
 * passed and the chart refuses to render the projects, naming the field. Off, none, so the
 * flag-off render is unchanged.
 */
export function suborgDeliveryArgs(
  repository: Pick<Repository, "environment" | "suborgDelivery">,
  component: string,
): string[] {
  const repoURL = repository.suborgDelivery?.repoURL;
  return featureEnabled(repository.environment, suborgDeliveryProjectFlag) &&
    component === "kore-platform-apis" &&
    repoURL !== undefined
    ? ["--set-string", `suborgDelivery.repoURL=${repoURL}`]
    : [];
}
