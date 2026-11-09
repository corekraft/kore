import type { Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

// Docs: docs/decisions/0007-workload-identity-and-layered-authorization.md
// A throwaway in-mesh client for the opt-in live reference spec. It runs the
// application's own signed image (a catalog-approved, digest-qualified image
// that admission already accepts) under a chosen ServiceAccount and reports
// one HTTP status, so the mesh's answer to an identity the application never
// declared can be observed. It reads no Secret and leaves no pod behind.

export interface MeshProbe {
  /** The digest-qualified, signed image the workload already runs. */
  image: string;
  /** The identity the probe presents to the mesh. */
  serviceAccount: string;
  url: string;
}

export interface ProbeOutcome {
  status?: number;
  error?: string;
}

export function meshProbePod(probe: MeshProbe & { name: string }): object {
  const script = `fetch(${JSON.stringify(probe.url)}).then((r) => console.log("STATUS " + r.status)).catch((e) => console.log("ERROR " + e.message))`;
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: probe.name,
      labels: { "app.kubernetes.io/name": "kore-reference-probe" },
    },
    spec: {
      restartPolicy: "Never",
      serviceAccountName: probe.serviceAccount,
      automountServiceAccountToken: false,
      containers: [
        {
          name: "probe",
          image: probe.image,
          command: ["node", "-e", script],
          resources: {
            requests: { cpu: "10m", memory: "32Mi" },
            limits: { cpu: "100m", memory: "128Mi" },
          },
          securityContext: {
            allowPrivilegeEscalation: false,
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            capabilities: { drop: ["ALL"] },
          },
        },
      ],
    },
  };
}

export function parseProbeOutcome(logs: string): ProbeOutcome {
  for (const line of logs.split("\n")) {
    const status = /^STATUS (\d{3})$/.exec(line.trim());
    if (status) {
      return { status: Number(status[1]) };
    }
    const error = /^ERROR (.+)$/.exec(line.trim());
    if (error) {
      return { error: error[1]! };
    }
  }
  throw new Error(
    `the probe printed no result: ${logs.trim() || "(no output)"}`,
  );
}

/** Runs the probe to completion and deletes its pod whatever happens. */
export async function runMeshProbe(
  repository: Repository,
  runner: Runner,
  namespace: string,
  probe: MeshProbe,
): Promise<ProbeOutcome> {
  const name = `kore-reference-probe-${Date.now().toString(36)}`;
  const scope = [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    namespace,
  ];
  try {
    await runner.run("kubectl", [...scope, "apply", "--filename=-"], {
      capture: true,
      input: JSON.stringify(meshProbePod({ ...probe, name })),
    });
    await runner.run(
      "kubectl",
      [
        ...scope,
        "wait",
        "--for=jsonpath={.status.phase}=Succeeded",
        `pod/${name}`,
        "--timeout=120s",
      ],
      { capture: true },
    );
    const { stdout } = await runner.run(
      "kubectl",
      [...scope, "logs", `pod/${name}`],
      { capture: true },
    );
    return parseProbeOutcome(stdout);
  } finally {
    await runner.run(
      "kubectl",
      [...scope, "delete", `pod/${name}`, "--ignore-not-found", "--wait=false"],
      { capture: true },
    );
  }
}
