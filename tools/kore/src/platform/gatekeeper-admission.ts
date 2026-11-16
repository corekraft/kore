import { enabledComponents, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";
import { waitForWebhook } from "./readiness-webhook.js";

const GATEKEEPER = "gatekeeper";
const VALIDATING_WEBHOOK =
  "validatingwebhookconfiguration/gatekeeper-validating-webhook-configuration";

/**
 * Waits until Gatekeeper's admission webhook can answer. Its webhook fails
 * closed, so after a cluster restart every namespace or object the next
 * component creates is refused until the webhook Service has a ready endpoint.
 * The wait fails with that cause, not a bare timeout. An environment without
 * Gatekeeper waits for nothing.
 */
export async function waitForGatekeeperAdmission(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const gatekeeper = enabledComponents(repository).find(
    ({ name }) => name === GATEKEEPER,
  );
  if (!gatekeeper) {
    return;
  }
  const { kubeContext } = repository.environment;
  try {
    await waitForWebhook(
      runner,
      kubeContext,
      VALIDATING_WEBHOOK,
      gatekeeper.timeout,
    );
  } catch (error) {
    throw new Error(
      `Gatekeeper webhook is not ready in ${kubeContext} after ${gatekeeper.timeout}: ${errorMessage(error)}. Gatekeeper fails closed, so the next component's objects would be refused. Check \`kubectl --context ${kubeContext} --namespace gatekeeper-system get pods\` until the gatekeeper-controller-manager pods are Ready, then rerun the command.`,
    );
  }
}
