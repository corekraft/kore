import { apiserverReadyFlag, featureEnabled } from "./features.js";
import type { Environment } from "./types.js";

// Docs: infra/catalog/compatibility.md (the Keycloak operator's startup probe, issue 2011)

/**
 * The startup probe failures the operator tolerates while the flag is on: 30
 * failures at the probe's 10 s period, 300 s, which covers a JVM start of
 * three minutes. Upstream's 3 allows about 35 s, and a start of about 27 s on a
 * loaded host was killed with exit 143 (CrashLoopBackOff).
 */
const operatorStartupFailureThreshold = 30;

/**
 * Helm arguments that give the Keycloak operator's startup probe room for a
 * slow JVM start under platform-apiserver-ready. With the flag off the release
 * gets no argument, so the chart's default (upstream's 3) applies and the
 * render is byte-identical to before.
 */
export function keycloakOperatorProbeHelmArgs(
  environment: Pick<Environment, "features">,
  component: string,
): string[] {
  if (
    component !== "keycloak-operator" ||
    !featureEnabled(environment, apiserverReadyFlag)
  ) {
    return [];
  }
  return [
    "--set",
    `operator.startupProbe.failureThreshold=${operatorStartupFailureThreshold}`,
  ];
}
