import { createHash } from "node:crypto";
import { featureEnabled, type Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { declaredGateParameters } from "./admission-gate-schema.js";

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

/**
 * Kubernetes' own workload controllers. A closed gate refuses new application
 * mutations but must not stop these replacing a Pod of a workload admitted
 * while it was open (ADR 0067).
 */
export const controllerIdentities = [
  "system:kube-controller-manager",
  ...[
    "replicaset-controller",
    "replication-controller",
    "deployment-controller",
    "statefulset-controller",
    "daemon-set-controller",
    "job-controller",
    "cronjob-controller",
  ].map((name) => `system:serviceaccount:kube-system:${name}`),
];

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
      /** Controllers that keep already-admitted workloads running while closed. */
      controllerIdentities: string[];
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
  // A flag that gates a component changes what is installed, so its value moves
  // the generation; a catalog with no gated component hashes as before.
  const gated = repository.catalog.components
    .filter(({ featureFlag }) => featureFlag !== undefined)
    .map(
      ({ name, featureFlag }) =>
        `${name}=${featureEnabled(repository.environment, featureFlag!)}`,
    );
  const hash = createHash("sha256")
    .update(repository.environment.name)
    .update("\0")
    .update(JSON.stringify(repository.catalog.components));
  if (gated.length) {
    hash.update("\0").update(gated.join(","));
  }
  const digest = hash.digest("hex");
  return `g-${digest.slice(0, 12)}`;
}

export function admissionGate(
  repository: Repository,
  state: "closed" | "open",
): AdmissionGate {
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
          {
            apiGroups: [""],
            kinds: ["Namespace", "Pod", "ReplicationController"],
          },
          {
            apiGroups: ["apps", "batch"],
            kinds: [
              "Deployment",
              "ReplicaSet",
              "StatefulSet",
              "DaemonSet",
              "Job",
              "CronJob",
            ],
          },
          { apiGroups: ["platform.kore.dev"], kinds: ["PostgreSQLInstance"] },
        ],
      },
      parameters: {
        generation: platformGeneration(repository),
        state,
        platformNamespaces,
        // The local kubeconfig identity is the Minikube admin certificate, so
        // locally bootstrap is also system:masters (ADR 0054).
        bootstrapGroups:
          repository.environment.provider === "minikube"
            ? [bootstrapGroup, "system:masters"]
            : [bootstrapGroup],
        controllerIdentities,
      },
    },
  };
}

export function closedAdmissionGate(repository: Repository): AdmissionGate {
  return admissionGate(repository, "closed");
}

async function writeGate(
  repository: Repository,
  runner: Runner,
  state: "closed" | "open",
): Promise<void> {
  const gate = admissionGate(repository, state);
  const declared = await declaredGateParameters(repository, runner);
  if (declared !== undefined && !declared.has("controllerIdentities")) {
    if (state === "open") {
      throw new Error(
        `the KoreApplicationAdmission template in ${repository.environment.kubeContext} does not declare controllerIdentities yet: kore-policy-templates has not been applied or Gatekeeper has not regenerated the constraint CRD. The gate stays closed; rerun kore platform up --environment ${repository.environment.name}`,
      );
    }
    // Closed with the parameters the old template declares: it still refuses
    // every application mutation, and the run's own template update, followed
    // by the final write, restores the controller exemption.
    const { controllerIdentities: _omitted, ...parameters } =
      gate.spec.parameters;
    void _omitted;
    gate.spec.parameters = parameters as AdmissionGate["spec"]["parameters"];
  }
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
    { capture: true, input: JSON.stringify(gate) },
  );
}

/** Creates the gate closed, or closes it again. */
export async function ensureClosedAdmissionGate(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await writeGate(repository, runner, "closed");
}

/**
 * Opens the gate for the current generation. Callers must have proved every
 * platform prerequisite ready in the same run (ADR 0054).
 */
export async function openAdmissionGate(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  await writeGate(repository, runner, "open");
}

/**
 * Closes an existing gate that is open or belongs to another generation, at the
 * start of a run. An absent gate (a fresh cluster) is left for the end of the
 * run to create.
 */
export async function closeExistingAdmissionGate(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const gate = await readAdmissionGate(repository, runner);
  if (
    gate !== undefined &&
    (gate.state !== "closed" ||
      gate.generation !== platformGeneration(repository))
  ) {
    await ensureClosedAdmissionGate(repository, runner);
  }
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

export const admissionGateStatusName = "application-admission-gate";

export interface GateStatus {
  name: string;
  namespace: string;
  status: "ready" | "missing" | "degraded";
  detail: string;
}

/** The gate as a status row: ready only when open for the current generation. */
export async function admissionGateStatus(
  repository: Repository,
  runner: Runner,
): Promise<GateStatus> {
  const identity = { name: admissionGateStatusName, namespace: "cluster" };
  const current = platformGeneration(repository);
  let gate: AdmissionGateState | undefined;
  try {
    gate = await readAdmissionGate(repository, runner);
  } catch (error) {
    return {
      ...identity,
      status: "missing",
      detail: `gate could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (gate === undefined) {
    return { ...identity, status: "missing", detail: "gate does not exist" };
  }
  if (gate.generation !== current) {
    return {
      ...identity,
      status: "degraded",
      detail: `stale: gate is generation ${gate.generation || "(none)"}, repository is ${current}`,
    };
  }
  return {
    ...identity,
    status: gate.state === "open" ? "ready" : "degraded",
    detail: `${gate.state === "open" ? "open" : "closed"} for generation ${current}`,
  };
}
