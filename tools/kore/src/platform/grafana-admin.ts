import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

const namespace = "observability";

/**
 * Makes Grafana's admin password equal the grafana-admin Secret (ADR 0080).
 * Grafana applies GF_SECURITY_ADMIN_PASSWORD only when it first creates its
 * database, so a profile whose PVC predates the ExternalSecret keeps the old
 * password. This resets it from inside the pod, whose environment already holds
 * the Secret's value: the password never reaches kore, an argument, or a log.
 * It is safe on every run, and a no-op change on a fresh profile.
 */
export async function reconcileGrafanaAdminPassword(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const script =
    'printf %s "$GF_SECURITY_ADMIN_PASSWORD" | grafana cli admin reset-admin-password --password-from-stdin';
  try {
    await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "--namespace",
        namespace,
        "exec",
        "deploy/grafana",
        "--container=grafana",
        "--",
        "sh",
        "-c",
        script,
      ],
      { capture: true },
    );
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    throw new Error(
      `could not set the Grafana admin password from the grafana-admin Secret: kubectl exec on deploy/grafana in ${namespace} failed (exit ${error.result.code}). Check that the grafana pod is Ready, then rerun kore local up; its output is withheld because it can hold credentials`,
    );
  }
}
