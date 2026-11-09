import type { Runner } from "../runtime/index.js";

/**
 * `kubectl rollout status` also reports a DaemonSet that schedules no pods as
 * rolled out, so an outage of ztunnel, istio-cni or the otel agent would read
 * as ready. A DaemonSet must schedule at least one pod (not one per node:
 * taints and node selectors legitimately exclude nodes, which `numberReady`
 * equal to `desiredNumberScheduled` already covers), with every scheduled pod
 * ready, available and on the current revision. Every catalog DaemonSet
 * targets all nodes; one that must target none would need a catalog
 * declaration, so none passes silently.
 */
const STATUS_TEMPLATE = "{{json .status}}";

interface DaemonSetStatus {
  desiredNumberScheduled?: number;
  numberReady?: number;
  numberUnavailable?: number;
  updatedNumberScheduled?: number;
}

/** Names the first failing DaemonSet condition, or undefined when ready. */
function daemonSetFailure(status: DaemonSetStatus): string | undefined {
  const desired = status.desiredNumberScheduled ?? 0;
  const ready = status.numberReady ?? 0;
  const unavailable = status.numberUnavailable ?? 0;
  const updated = status.updatedNumberScheduled ?? 0;
  if (desired < 1) {
    return "desiredNumberScheduled is 0: no pods are scheduled (no node matches its nodeSelector or tolerations, or it is down)";
  }
  if (ready !== desired) {
    return `numberReady ${ready} of ${desired} desired`;
  }
  if (unavailable !== 0) {
    return `numberUnavailable is ${unavailable}`;
  }
  return updated === desired
    ? undefined
    : `updatedNumberScheduled ${updated} of ${desired} desired`;
}

/** Wraps the rollout wait with a read of the DaemonSet status. */
export function withScheduledPods(
  { runner, base }: { runner: Runner; base: string[] },
  resource: string,
  rollout: { run: (timeout: string) => Promise<void> },
): {
  condition: string;
  run: (timeout: string) => Promise<void>;
} {
  return {
    condition: "rollout complete and every desired pod scheduled and ready",
    run: async (timeout) => {
      await rollout.run(timeout);
      const result = await runner.run(
        "kubectl",
        [
          ...base,
          "get",
          resource,
          "--output",
          `go-template=${STATUS_TEMPLATE}`,
        ],
        { capture: true },
      );
      let status: DaemonSetStatus;
      try {
        status = JSON.parse(result.stdout) as DaemonSetStatus;
      } catch {
        throw new Error(`${resource} status is not readable JSON`);
      }
      const failure = daemonSetFailure(status);
      if (failure) {
        throw new Error(`${resource} ${failure}`);
      }
    },
  };
}
