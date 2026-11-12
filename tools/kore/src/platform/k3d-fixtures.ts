import type { RunResult } from "../runtime/index.js";

/** What `k3d cluster list --output json` prints for the running local cluster. */
export const runningK3dCluster = JSON.stringify([
  {
    name: "kore-local",
    serversCount: 1,
    serversRunning: 1,
    agentsCount: 0,
    agentsRunning: 0,
  },
]);

/** The answer of a fake runner to any `k3d` call: the cluster is running. */
export const runningK3d = (): RunResult => ({
  stdout: runningK3dCluster,
  stderr: "",
  code: 0,
});

/** What the load balancer fronts: a NodePort Service, never an address. */
export const nodePortService = JSON.stringify({
  items: [
    {
      spec: { type: "NodePort", ports: [{ port: 8443, nodePort: 30443 }] },
      status: { loadBalancer: {} },
    },
  ],
});
