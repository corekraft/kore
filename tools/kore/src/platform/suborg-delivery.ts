import { featureEnabled, suborgDeliveryProjectFlag } from "../config/index.js";
import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { koreRepositoryURL } from "./kore-repository.js";

// Docs: docs/decisions/0165-a-suborg-is-the-namespace-quota-and-trust-boundary-of-its-services.md

/**
 * With suborg-delivery-project on (ADR 0165, issue 1553), the repository carrying the Kore
 * URL its suborg AppProjects admit as their source, read from the git origin. Every command
 * that renders or installs the platform composes it first, so the platform-apis chart is
 * never handed a repository without it. Off, the repository is returned untouched and the
 * origin is not read.
 */
export async function composeSuborgDelivery(
  repository: Repository,
  runner: Runner,
): Promise<Repository> {
  if (!featureEnabled(repository.environment, suborgDeliveryProjectFlag)) {
    return repository;
  }
  return {
    ...repository,
    suborgDelivery: {
      repoURL: await koreRepositoryURL(
        repository,
        runner,
        "the suborg AppProjects need",
      ),
    },
  };
}
