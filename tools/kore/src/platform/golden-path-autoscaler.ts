// Docs: infra/plans/13-agentgateway-ingress.md#golden-path-route-set
//
// Reads the HorizontalPodAutoscaler that targets one Deployment out of the JSON
// of `kubectl get hpa`. Read-only: it parses what the cluster answered.

/** The HorizontalPodAutoscaler's bounds and scale-down window on its Deployment. */
export interface Autoscaler {
  minReplicas: number;
  maxReplicas: number;
  scaleDownWindowSeconds: number;
}

/** The scale-down stabilization window Kubernetes uses when an HPA sets none. */
export const defaultScaleDownWindowSeconds = 300;

interface Autoscalers {
  items?: {
    spec?: {
      scaleTargetRef?: { kind?: string; name?: string };
      minReplicas?: number;
      maxReplicas?: number;
      behavior?: { scaleDown?: { stabilizationWindowSeconds?: number } };
    };
  }[];
}

/** The autoscaler that targets the Deployment in the listing, or undefined when none does. */
export function autoscalerOf(
  listing: string,
  deployment: string,
): Autoscaler | undefined {
  const { items = [] } = JSON.parse(listing) as Autoscalers;
  const target = items.find(
    ({ spec }) =>
      spec?.scaleTargetRef?.kind === "Deployment" &&
      spec.scaleTargetRef.name === deployment,
  );
  if (target?.spec === undefined) {
    return undefined;
  }
  return {
    minReplicas: target.spec.minReplicas ?? 1,
    maxReplicas: target.spec.maxReplicas ?? 1,
    scaleDownWindowSeconds:
      target.spec.behavior?.scaleDown?.stabilizationWindowSeconds ??
      defaultScaleDownWindowSeconds,
  };
}
