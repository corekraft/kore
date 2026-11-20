import { otlpByName, otlpHostname, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { loadLocalCa } from "../security/index.js";
import { postOtlp, waitForOtlp, withForward } from "./otlp-forward.js";
import { postOtlpToName } from "./otlp-name.js";

// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md

/** One synthetic OTLP/HTTP JSON payload per signal. */
export type SyntheticPayloads = Record<"traces" | "logs" | "metrics", object>;

const namespace = "observability";

/**
 * Posts the three synthetic signals. With otlp-route on they go to the OTLP name
 * through the shared Gateway, verified against the local CA's public certificate
 * (ADR 0140). Off, a port-forward reaches the Collector's loopback-only receiver
 * on 4319, because the pod-IP receiver on 4318 refuses a forward (ADR 0062).
 */
export async function sendSyntheticSignals(
  repository: Repository,
  runner: Runner,
  payloads: SyntheticPayloads,
): Promise<void> {
  if (otlpByName(repository.environment)) {
    const ca = await loadLocalCa(repository, runner);
    const url = `https://${otlpHostname(repository.environment)}`;
    for (const signal of ["traces", "logs", "metrics"] as const) {
      await postOtlpToName({ url, ca, signal, payload: payloads[signal] });
    }
    return;
  }
  await withForward(
    {
      context: repository.environment.kubeContext,
      namespace,
      target: "deployment/otel-collector",
      remotePort: 4319,
    },
    async (port) => {
      await waitForOtlp(port);
      for (const signal of ["traces", "logs", "metrics"] as const) {
        await postOtlp(port, signal, payloads[signal]);
      }
    },
  );
}
