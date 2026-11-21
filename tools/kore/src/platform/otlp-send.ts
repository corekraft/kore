import { otlpByName, otlpHostname, type Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { loadLocalCa } from "../security/index.js";
import { postOtlpToName } from "./otlp-name.js";

// Docs: docs/decisions/0140-otlp-is-routed-by-name-to-the-standard-collector-receiver-behind-otlp-route.md

/** One synthetic OTLP/HTTP JSON payload per signal. */
export type SyntheticPayloads = Record<"traces" | "logs" | "metrics", object>;

/**
 * Posts the three synthetic signals to the OTLP name through the shared Gateway,
 * verified against the local CA's public certificate (ADR 0140). No host caller
 * opens a port-forward to the Collector: with otlp-route off nothing reaches the
 * Collector from the host, so the send is refused before any CA is read.
 */
export async function sendSyntheticSignals(
  repository: Repository,
  runner: Runner,
  payloads: SyntheticPayloads,
): Promise<void> {
  const { environment } = repository;
  if (!otlpByName(environment)) {
    throw new Error(
      `environment ${environment.name} reaches OTLP only by name, and otlp-route is off there; turn otlp-route on in the environment's overlay (ADR 0140), then converge the environment again`,
    );
  }
  const ca = await loadLocalCa(repository, runner);
  const url = `https://${otlpHostname(environment)}`;
  for (const signal of ["traces", "logs", "metrics"] as const) {
    await postOtlpToName({ url, ca, signal, payload: payloads[signal] });
  }
}
