import type { Component, Repository } from "../config/index.js";

/** The kore-golden-path-delivery chart's composed values as Helm arguments; none for any other component (ADR 0043, ADR 0166). */
export function goldenPathArgs(
  repository: Repository,
  component: Component,
): string[] {
  const golden = repository.goldenPathDelivery;
  if (component.name !== "kore-golden-path-delivery" || !golden) {
    return [];
  }
  return [
    "--set-string",
    `repoURL=${golden.repoURL}`,
    "--set-string",
    `revision=${golden.revision}`,
    "--set-string",
    `environment=${golden.environment}`,
    "--set-json",
    `templateImages=${JSON.stringify(golden.templateImages)}`,
    "--set-string",
    `ingress.platformDomain=${golden.ingress.platformDomain}`,
    "--set-string",
    `ingress.gatewayClassName=${golden.ingress.gatewayClassName}`,
    // Only while platform-shared-gateway is on, so the flag off passes nothing new.
    ...(golden.sharedGateway ? ["--set", "sharedGateway=true"] : []),
    // Only while autoscaling-defaults is on, so the flag off passes nothing new.
    ...(golden.autoscaling ? ["--set", "autoscaling=true"] : []),
    // Only while golden-path-template-admission is on, so the flag off passes nothing new.
    ...(golden.templateAdmission ? ["--set", "templateAdmission=true"] : []),
    // Only while platform-portal, platform-organization-service-apis and
    // platform-argocd-delivery are all on, so the flags off pass nothing new.
    ...(golden.serviceRecords ? ["--set", "serviceRecords=true"] : []),
    // Only while golden-path-signin is on, so the flag off passes nothing new.
    ...(golden.signin
      ? ["--set-string", `signin.issuerUri=${golden.signin.issuerUri}`]
      : []),
    // Only while golden-path-safety-defaults is on, so the flag off passes nothing new (ADR 0154).
    ...(golden.safetyDefaults ? ["--set", "safetyDefaults=true"] : []),
    // Only while app-delivery is on, so the flag off passes nothing new (ADR 0172).
    ...(golden.appDelivery ? ["--set", "appDelivery=true"] : []),
  ];
}
