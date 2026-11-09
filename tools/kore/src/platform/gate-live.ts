import { type Repository } from "../config/index.js";
import { CommandError, type Runner } from "../runtime/index.js";
import { admissionGateName, admissionGateResource } from "./admission-gate.js";
import { readinessEvidenceName } from "./readiness-manifest.js";

// The live proof's identities and kubectl access, shared by the proof helpers.

export const developer = [
  "--as",
  "kore-gate-developer",
  "--as-group",
  "kore:developers",
];
export const bootstrapUser = "kore-gate-bootstrap";
export const bootstrap = [
  "--as",
  bootstrapUser,
  "--as-group",
  "kore:bootstrap",
];
export const replicaSetController = [
  "--as",
  "system:serviceaccount:kube-system:replicaset-controller",
];
export const closedMessage = /application admission gate is closed/;
export const gateObject = `${admissionGateResource}/${admissionGateName}`;
export const evidenceObject = `configmaps/${readinessEvidenceName}`;
export const evidenceScope = ["-n", "kore-system"];

export interface Live {
  repository: Repository;
  runner: Runner;
}

export async function kubectl(
  { repository, runner }: Live,
  args: string[],
  input?: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await runner.run(
      "kubectl",
      ["--context", repository.environment.kubeContext, ...args],
      { capture: true, ...(input === undefined ? {} : { input }) },
    );
    return { ok: true, output: result.stdout.trim() };
  } catch (error) {
    if (error instanceof CommandError) {
      return { ok: false, output: error.result.stderr.trim() };
    }
    throw error;
  }
}

export async function canI(
  cluster: Live,
  identity: string[],
  request: [verb: string, resource: string, ...scope: string[]],
): Promise<boolean> {
  const [verb, resource, ...scope] = request;
  const answer = await kubectl(cluster, [
    ...identity,
    "auth",
    "can-i",
    verb,
    resource,
    ...scope,
  ]);
  return answer.output.startsWith("yes");
}
