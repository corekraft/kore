import { createHash } from "node:crypto";
import type { Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";

/**
 * The application admission gate (ADR 0054) is one Gatekeeper constraint of
 * the `KoreApplicationAdmission` template per environment. Bootstrap creates it
 * closed for the current platform generation and is its only owner (field
 * manager `kore-bootstrap-gate`); opening it belongs to the complete bootstrap
 * generation (plan Step 13) and is not implemented here.
 */
export const admissionGateResource =
  "koreapplicationadmission.constraints.gatekeeper.sh";
export const admissionGateName = "kore-application-admission";
export const admissionGateFieldManager = "kore-bootstrap-gate";
/** Namespace metadata that activates an application namespace for one generation. */
export const activationLabel = "platform.kore.dev/activation-generation";
export const bootstrapGroup = "kore:bootstrap";

const systemNamespaces = ["kube-system", "kube-public", "kube-node-lease"];

export interface AdmissionGate {
  apiVersion: "constraints.gatekeeper.sh/v1beta1";
  kind: "KoreApplicationAdmission";
  metadata: { name: string };
  spec: {
    // Audit before enforce (ADR 0054): promoted to `deny` after a clean audit.
    enforcementAction: "dryrun";
    match: { kinds: { apiGroups: string[]; kinds: string[] }[] };
    parameters: {
      generation: string;
      state: "closed" | "open";
      platformNamespaces: string[];
      bootstrapGroups: string[];
    };
  };
}

/**
 * Identifies one bootstrap generation: the environment and everything the
 * catalog installs into it. A change to the desired platform state moves the
 * generation on, which makes the previous gate and every namespace activated
 * under it stale until bootstrap revalidates and replaces them.
 */
export function platformGeneration(repository: Repository): string {
  const digest = createHash("sha256")
    .update(repository.environment.name)
    .update("\0")
    .update(JSON.stringify(repository.catalog.components))
    .digest("hex");
  return `g-${digest.slice(0, 12)}`;
}

export function closedAdmissionGate(repository: Repository): AdmissionGate {
  const platformNamespaces = [
    ...new Set([
      ...systemNamespaces,
      ...repository.catalog.components.map((component) => component.namespace),
    ]),
  ].sort();
  return {
    apiVersion: "constraints.gatekeeper.sh/v1beta1",
    kind: "KoreApplicationAdmission",
    metadata: { name: admissionGateName },
    spec: {
      enforcementAction: "dryrun",
      match: {
        kinds: [
          { apiGroups: [""], kinds: ["Namespace", "Pod"] },
          {
            apiGroups: ["apps", "batch"],
            kinds: ["Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"],
          },
          { apiGroups: ["platform.kore.dev"], kinds: ["PostgreSQLInstance"] },
        ],
      },
      parameters: {
        generation: platformGeneration(repository),
        state: "closed",
        platformNamespaces,
        // The local kubeconfig identity is the Minikube admin certificate, so
        // locally bootstrap is also system:masters (ADR 0054).
        bootstrapGroups:
          repository.environment.provider === "minikube"
            ? [bootstrapGroup, "system:masters"]
            : [bootstrapGroup],
      },
    },
  };
}

/** Creates the gate closed, or closes it again; the one write kore makes to it. */
export async function ensureClosedAdmissionGate(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await runner.run(
    "kubectl",
    [
      "--context",
      repository.environment.kubeContext,
      "apply",
      "--server-side",
      `--field-manager=${admissionGateFieldManager}`,
      "--force-conflicts",
      "--filename=-",
    ],
    { capture: true, input: JSON.stringify(closedAdmissionGate(repository)) },
  );
}

export interface AdmissionGateState {
  generation: string;
  state: string;
}

/** Reads the gate from the configured context; undefined when it does not exist. */
export async function readAdmissionGate(
  repository: Repository,
  runner: Runner,
): Promise<AdmissionGateState | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "get",
        admissionGateResource,
        admissionGateName,
        "--ignore-not-found",
        "--output",
        "json",
      ],
      { capture: true },
    ));
  } catch (error) {
    if (
      error instanceof CommandError &&
      /doesn't have a resource type|could not find the requested resource/.test(
        error.result.stderr,
      )
    ) {
      return undefined;
    }
    throw error;
  }
  if (stdout.trim() === "") {
    return undefined;
  }
  const parameters = (
    JSON.parse(stdout) as {
      spec?: { parameters?: { generation?: string; state?: string } };
    }
  ).spec?.parameters;
  return {
    generation: parameters?.generation ?? "",
    state: parameters?.state ?? "closed",
  };
}

/**
 * Refuses application admission unless the gate is open for the current
 * generation. Supplements the cluster-side policy and does not replace it.
 * Returns the generation to activate namespaces under.
 */
export async function assertAdmissionGateOpen(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  const current = platformGeneration(repository);
  const gate = await readAdmissionGate(repository, runner);
  if (gate === undefined) {
    throw new Error(
      `the application admission gate does not exist in ${repository.environment.kubeContext}: the platform has not finished bootstrap. Run kore platform up --environment ${repository.environment.name}; applications are refused until it opens the gate`,
    );
  }
  if (gate.generation !== current) {
    throw new Error(
      `the application admission gate is stale: it is for platform generation ${gate.generation || "(none)"} but the repository is generation ${current}. Run kore platform up --environment ${repository.environment.name} to revalidate the platform and replace it`,
    );
  }
  if (gate.state !== "open") {
    throw new Error(
      `the application admission gate is closed for platform generation ${current}: bootstrap opens it only after every platform prerequisite is ready. Run kore platform up --environment ${repository.environment.name}, then retry; nothing was applied`,
    );
  }
  return current;
}
