// Config answers the helm unit's specs read through the mocked config barrel.
// Fixtures only the helm spec uses, so they live beside it (ADR 0098).
import { vi } from "vitest";
import {
  absolute,
  alertEmailHelmArgs,
  alertForwardingHelmArgs,
  componentValues,
  componentVersion,
  dashboardSidecarHelmArgs,
  expandVersions,
  featureHelmArgs,
  gatewayClassName,
  keycloakOperatorProbeHelmArgs,
  noMatchPolicy,
  platformHelmArgs,
  prometheusPortalHelmArgs,
  registeredServiceHelmArgs,
  registryHelmArgs,
  suborgDeliveryArgs,
} from "../config/index.js";

/** Sets each config answer to the value a helm argument needs, as the real barrel gives it. */
export function configAnswers(): void {
  vi.mocked(absolute).mockImplementation(
    (repo, path) => `${repo.root}/${path}`,
  );
  vi.mocked(alertEmailHelmArgs).mockReturnValue([]);
  vi.mocked(alertForwardingHelmArgs).mockReturnValue([]);
  vi.mocked(componentValues).mockReturnValue([]);
  vi.mocked(componentVersion).mockReturnValue("1.2.3");
  vi.mocked(dashboardSidecarHelmArgs).mockReturnValue([]);
  vi.mocked(expandVersions).mockImplementation((_repo, value) => value);
  vi.mocked(featureHelmArgs).mockReturnValue([]);
  vi.mocked(gatewayClassName).mockReturnValue("kore-gateway");
  vi.mocked(keycloakOperatorProbeHelmArgs).mockReturnValue([]);
  vi.mocked(noMatchPolicy).mockReturnValue("warn");
  vi.mocked(platformHelmArgs).mockReturnValue([]);
  vi.mocked(suborgDeliveryArgs).mockReturnValue([]);
  vi.mocked(prometheusPortalHelmArgs).mockReturnValue([]);
  vi.mocked(registeredServiceHelmArgs).mockReturnValue([]);
  vi.mocked(registryHelmArgs).mockImplementation((_env, name) => [
    "--set-string",
    `registry=${name}`,
  ]);
}
